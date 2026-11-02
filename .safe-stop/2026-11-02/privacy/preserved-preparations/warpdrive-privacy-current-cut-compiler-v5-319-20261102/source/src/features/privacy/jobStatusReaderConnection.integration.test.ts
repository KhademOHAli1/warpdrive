import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { createDiscoveryJobStatusReader } from "./jobStatus";
import {
  nativeExpectedStatus,
  observeQueuedCheckout,
  observeUntil,
  queuedReaderFixture,
  type ReaderOutcome,
  withReaderPool,
} from "./jobStatusReaderConnection.test-helpers";

let h: TestDb;
beforeAll(async () => {
  h = await makeTestDb();
}, 20_000);
afterAll(async () => {
  await h.close();
}, 15_000);
const bounded = (signal: AbortSignal) => AbortSignal.any([signal, AbortSignal.timeout(8000)]);

test("factory healthy control returns the actual authorized status and leaves the same max-one pool usable", async ({
  signal,
}) => {
  const fixture = await queuedReaderFixture(h, bounded(signal));
  await withReaderPool(h, fixture, {}, async (pool, cancellationPool, observer) => {
    const acquired: PoolClient[] = [];
    pool.on("acquire", (client) => {
      acquired.push(client);
    });
    const read = createDiscoveryJobStatusReader(pool, cancellationPool);
    expect(await read(fixture.actor, fixture.input, bounded(signal))).toEqual({
      ok: true,
      value: await nativeExpectedStatus(observer, fixture),
    });
    expect(acquired).toHaveLength(1);
    expect(pool.waitingCount).toBe(0);
    expect(pool.idleCount).toBe(1);
    expect((await pool.query<{ usable: number }>("SELECT 1 AS usable")).rows).toEqual([
      { usable: 1 },
    ]);
    expect(acquired).toHaveLength(2);
    expect(acquired[1]).toBe(acquired[0]);
  });
}, 20_000);

test("factory pre-abort preserves the exact arbitrary reason without native checkout", async ({
  signal,
}) => {
  const fixture = await queuedReaderFixture(h, bounded(signal));
  await withReaderPool(h, fixture, {}, async (pool, cancellationPool) => {
    let acquired = 0;
    pool.on("acquire", () => {
      acquired += 1;
    });
    const reason = Object.freeze({ kind: "synthetic_precheckout_abort", nonce: randomUUID() });
    await expect(
      createDiscoveryJobStatusReader(pool, cancellationPool)(
        fixture.actor,
        fixture.input,
        AbortSignal.abort(reason),
      ),
    ).rejects.toBe(reason);
    expect({ acquired, total: pool.totalCount, waiting: pool.waitingCount }).toEqual({
      acquired: 0,
      total: 0,
      waiting: 0,
    });
  });
}, 20_000);

for (const boundary of ["missing selector", "invalid identifier", "extra actor field"] as const)
  test(`factory strict ${boundary} rejection avoids checkout`, async ({ signal }) => {
    const fixture = await queuedReaderFixture(h, bounded(signal));
    await withReaderPool(h, fixture, {}, async (pool, cancellationPool) => {
      let acquired = 0;
      pool.on("acquire", () => {
        acquired += 1;
      });
      const input =
        boundary === "missing selector"
          ? null
          : boundary === "invalid identifier"
            ? { ...fixture.input, jobId: "invalid" }
            : { ...fixture.input, userId: fixture.actor.userId };
      expect(
        await createDiscoveryJobStatusReader(pool, cancellationPool)(
          fixture.actor,
          input,
          bounded(signal),
        ),
      ).toEqual({ ok: false, error: "invalid_input" });
      expect({ acquired, total: pool.totalCount, waiting: pool.waitingCount }).toEqual({
        acquired: 0,
        total: 0,
        waiting: 0,
      });
    });
  }, 20_000);

for (const boundary of ["unbounded checkout", "multiple clients", "pipeline enabled"] as const)
  test(`factory rejects a supplied pool with ${boundary} before checkout`, async ({ signal }) => {
    const fixture = await queuedReaderFixture(h, bounded(signal));
    const options =
      boundary === "unbounded checkout"
        ? { connectionTimeoutMillis: 0 }
        : boundary === "multiple clients"
          ? { max: 2 }
          : { pipeline: true };
    await withReaderPool(h, fixture, options, async (pool, cancellationPool) => {
      let acquired = 0;
      pool.on("acquire", () => {
        acquired += 1;
      });
      expect(
        await createDiscoveryJobStatusReader(pool, cancellationPool)(
          fixture.actor,
          fixture.input,
          bounded(signal),
        ),
      ).toEqual({ ok: false, error: "storage_unavailable" });
      expect({ acquired, total: pool.totalCount, waiting: pool.waitingCount }).toEqual({
        acquired: 0,
        total: 0,
        waiting: 0,
      });
    });
  }, 20_000);

test("aborted queued checkout settles before holder release; the late client is discarded and the same pool recovers", async ({
  signal,
}) => {
  const fixture = await queuedReaderFixture(h, bounded(signal));
  await withReaderPool(
    h,
    fixture,
    { application_name: `privacy-acquire-${randomUUID()}` },
    async (pool, cancellationPool, observer) => {
      const acquired: PoolClient[] = [];
      const removed: PoolClient[] = [];
      pool.on("acquire", (client) => {
        acquired.push(client);
      });
      pool.on("remove", (client) => {
        removed.push(client);
      });
      const holder = await pool.connect();
      let holderReleased = false;
      const caller = new AbortController();
      const reason = Object.freeze({
        kind: "synthetic_queued_checkout_abort",
        nonce: randomUUID(),
      });
      let outcome: Promise<ReaderOutcome> | undefined;
      try {
        const identity = await holder.query<{
          pid: number;
          birth: string;
        }>(`SELECT pg_backend_pid() AS pid,
        (SELECT backend_start::text FROM pg_stat_activity WHERE pid=pg_backend_pid()) AS birth`);
        const original = identity.rows[0];
        assert(original !== undefined, "SETUP: retained native max-one holder identity missing");
        const read = createDiscoveryJobStatusReader(pool, cancellationPool);
        outcome = read(
          fixture.actor,
          fixture.input,
          AbortSignal.any([signal, caller.signal, AbortSignal.timeout(8000)]),
        ).then(
          (value) => ({ kind: "resolved" as const, value }),
          (cause: unknown) => ({ kind: "rejected" as const, reason: cause }),
        );
        const queued = await observeQueuedCheckout(pool, outcome, bounded(signal));
        assert(
          queued !== "setup_deadline",
          "SETUP/TIMING: actual pending max-one checkout not observed",
        );
        expect(
          queued,
          "BEHAVIOR: reader settled without waiting behind the retained native client",
        ).toBe("waiting");
        const abortedAt = performance.now();
        caller.abort(reason);
        const result = await outcome;
        expect(result.kind).toBe("rejected");
        if (result.kind === "rejected") expect(result.reason).toBe(reason);
        expect(performance.now() - abortedAt).toBeLessThan(1000);
        expect({ holderReleased, acquired: acquired.length, waiting: pool.waitingCount }).toEqual({
          holderReleased: false,
          acquired: 1,
          waiting: 1,
        });
        expect(
          (
            await holder.query<{ pid: number; usable: number }>(
              "SELECT pg_backend_pid() AS pid, 1 AS usable",
            )
          ).rows,
        ).toEqual([{ pid: original.pid, usable: 1 }]);

        holderReleased = true;
        holder.release();
        const retired = await observeUntil(
          async () => {
            if (
              !removed.includes(holder) ||
              acquired.length !== 2 ||
              pool.waitingCount !== 0 ||
              pool.totalCount !== 0 ||
              pool.idleCount !== 0
            )
              return false;
            const backend = await observer.query<{ gone: boolean }>(
              `SELECT NOT EXISTS(
          SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND backend_start=$2::timestamptz) AS gone`,
              [original.pid, original.birth],
            );
            return backend.rows[0]?.gone === true;
          },
          2000,
          bounded(signal),
        );
        expect(
          retired,
          "BEHAVIOR: late checkout/native backend retirement must be observed, not inferred from abort",
        ).toBe(true);
        expect(acquired[1]).toBe(holder);
        expect(removed.filter((client) => client === holder)).toHaveLength(1);
        expect((await pool.query<{ usable: number }>("SELECT 1 AS usable")).rows).toEqual([
          { usable: 1 },
        ]);
        expect(acquired[2]).not.toBe(holder);
        expect(await read(fixture.actor, fixture.input, bounded(signal))).toEqual({
          ok: true,
          value: await nativeExpectedStatus(observer, fixture),
        });
      } finally {
        caller.abort(reason);
        if (!holderReleased) {
          holderReleased = true;
          holder.release();
        }
        // The reader's own finite checkout/native budgets govern any late acquisition.
        await outcome;
      }
    },
  );
}, 20_000);
