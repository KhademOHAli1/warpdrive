import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { expect } from "vitest";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { privacyCases } from "@/db/schema";
import type { TestDb } from "@/test/db";
import { err, type Result } from "@/types/result";
import type { authorityFixture } from "./authority.test-helpers";

type Fixture = Awaited<ReturnType<typeof authorityFixture>>;
type Failed = { ok: false; error: "synthetic_saved_failure" };
type Invoke = (
  db: Db,
  signal: AbortSignal,
  effect: (tx: Db) => Promise<Failed>,
) => Promise<Result<unknown, unknown>>;
type Outcome =
  | { kind: "resolved"; value: Result<unknown, unknown> }
  | { kind: "rejected"; reason: unknown };
type Backend = { pid: number; backendStart: string };

function armNativeRollbackAck(
  client: PoolClient,
  controller: AbortController,
  reason: object,
  outerSettled: () => boolean,
) {
  const stats = {
    transactionReadyCount: 0,
    rollbackTags: 0,
    idleRollbackAcks: 0,
    unexpectedIdle: 0,
    invalidMessage: false,
    transactionStatusDisagreed: false,
    prematureAbort: false,
    outerSettledAtAck: false,
  };
  let rollbackTagged = false;
  const onCommand = (message: unknown) => {
    if (
      typeof message !== "object" ||
      message === null ||
      !("text" in message) ||
      typeof message.text !== "string"
    ) {
      stats.invalidMessage = true;
      return;
    }
    if (message.text === "ROLLBACK") {
      rollbackTagged = true;
      stats.rollbackTags += 1;
    }
  };
  const onReady = (message: unknown) => {
    if (
      typeof message !== "object" ||
      message === null ||
      !("status" in message) ||
      typeof message.status !== "string"
    ) {
      stats.invalidMessage = true;
      return;
    }
    const status = message.status;
    if (client.getTransactionStatus() !== status) stats.transactionStatusDisagreed = true;
    if (status === "T") {
      stats.transactionReadyCount += 1;
      if (controller.signal.aborted) stats.prematureAbort = true;
    } else if (status === "I") {
      if (!rollbackTagged) {
        stats.unexpectedIdle += 1;
        return;
      }
      stats.idleRollbackAcks += 1;
      stats.outerSettledAtAck = outerSettled();
      if (!controller.signal.aborted) controller.abort(reason);
    } else stats.invalidMessage = true;
  };
  // Append only: pg's existing protocol handlers retain their normal order and behavior.
  const readyCount = client.connection.listenerCount("readyForQuery");
  const commandCount = client.connection.listenerCount("commandComplete");
  client.connection.on("commandComplete", onCommand);
  client.connection.on("readyForQuery", onReady);
  return {
    stats,
    dispose: () => {
      client.connection.off("commandComplete", onCommand);
      client.connection.off("readyForQuery", onReady);
      expect(client.connection.listenerCount("readyForQuery")).toBe(readyCount);
      expect(client.connection.listenerCount("commandComplete")).toBe(commandCount);
    },
  };
}

async function snapshot(observer: Pool) {
  const result = await observer.query<{ state: unknown }>(`SELECT jsonb_build_object(
    'cases', (SELECT jsonb_agg(t ORDER BY id) FROM privacy_cases t),
    'proofs', (SELECT jsonb_agg(t ORDER BY case_id) FROM privacy_case_verifications t),
    'events', (SELECT jsonb_agg(t ORDER BY id) FROM privacy_case_events t),
    'jobs', (SELECT jsonb_agg(t ORDER BY id) FROM privacy_jobs t)
  ) AS state`);
  const row = result.rows[0];
  assert(row !== undefined, "SETUP: missing independent native state snapshot");
  return row.state;
}

export async function exerciseRollbackAckAbort(
  h: TestDb,
  fixture: Fixture,
  invoke: Invoke,
  testSignal: AbortSignal,
) {
  const pool = new Pool({
    connectionString: h.url,
    max: 1,
    pipeline: false,
    application_name: `privacy-rollback-ack-${randomUUID()}`,
    connectionTimeoutMillis: 1000,
    statement_timeout: 5000,
    query_timeout: 7000,
  });
  const observer = new Pool({
    connectionString: h.url,
    max: 1,
    pipeline: false,
    connectionTimeoutMillis: 1000,
    statement_timeout: 1000,
    query_timeout: 1500,
  });
  const controller = new AbortController();
  const reason = Object.freeze({ kind: "synthetic_rollback_ack_abort", nonce: randomUUID() });
  const signal = AbortSignal.any([testSignal, controller.signal, AbortSignal.timeout(8000)]);
  let client: PoolClient | undefined;
  let armed: ReturnType<typeof armNativeRollbackAck> | undefined;
  let outcome: Promise<Outcome> | undefined;
  let before: unknown;
  let outerSettled = false;
  let wrote = false;
  let returnedFailure = false;
  let primary: { error: unknown } | undefined;
  const cleanupFailures: unknown[] = [];
  try {
    before = await snapshot(observer);
    client = await pool.connect();
    const owned = client;
    expect(owned.pipeline).toBe(false);
    const identitySql = `SELECT pg_backend_pid() AS pid,
      (SELECT backend_start::text FROM pg_stat_activity WHERE pid=pg_backend_pid()) AS "backendStart"`;
    const original = (await owned.query<Backend>(identitySql)).rows[0];
    assert(original !== undefined, "SETUP: missing exact native client identity");
    const operation = invoke(drizzle(owned, { schema }), signal, async (tx) => {
      const changed = await tx
        .update(privacyCases)
        .set({ unresolvedObligations: 1 })
        .where(eq(privacyCases.id, fixture.privacyCase.id))
        .returning({ unresolvedObligations: privacyCases.unresolvedObligations });
      expect(changed).toEqual([{ unresolvedObligations: 1 }]);
      wrote = true;
      expect(signal.aborted, "earlier native authentication and UPDATE must not abort").toBe(false);
      expect(owned.getTransactionStatus()).toBe("T");
      armed = armNativeRollbackAck(owned, controller, reason, () => outerSettled);
      await tx.execute(sql`SELECT 1 AS transaction_ready_control`);
      expect(signal.aborted, "native ReadyForQuery T must leave the signal live").toBe(false);
      returnedFailure = true;
      return err("synthetic_saved_failure" as const);
    });
    outcome = operation.then(
      (value) => {
        outerSettled = true;
        return { kind: "resolved" as const, value };
      },
      (cause: unknown) => {
        outerSettled = true;
        return { kind: "rejected" as const, reason: cause };
      },
    );
    const result = await outcome;
    assert(armed !== undefined, "SETUP: real failed effect never armed its native listener");
    expect(wrote).toBe(true);
    expect(returnedFailure).toBe(true);
    expect(armed.stats.transactionReadyCount).toBeGreaterThanOrEqual(1);
    expect(armed.stats.rollbackTags).toBe(1);
    expect(armed.stats.idleRollbackAcks).toBe(1);
    expect(armed.stats.unexpectedIdle).toBe(0);
    expect(armed.stats.invalidMessage).toBe(false);
    expect(armed.stats.transactionStatusDisagreed).toBe(false);
    expect(armed.stats.prematureAbort).toBe(false);
    expect(armed.stats.outerSettledAtAck).toBe(false);
    expect(controller.signal.reason).toBe(reason);
    expect(signal.reason).toBe(reason);
    expect(owned.getTransactionStatus()).toBe("I");
    // Detach before the independent post-ACK identity query can emit another idle message.
    armed.dispose();
    armed = undefined;
    expect((await owned.query<Backend>(identitySql)).rows).toEqual([original]);
    expect(
      await snapshot(observer),
      "the actual earlier write must already be rolled back",
    ).toEqual(before);
    expect(result.kind, "abort at native rollback ACK must override the saved failed Result").toBe(
      "rejected",
    );
    if (result.kind === "rejected") expect(result.reason).toBe(reason);
  } catch (error) {
    primary = { error };
  } finally {
    const retain = async (effect: () => Promise<unknown>) => {
      try {
        await effect();
      } catch (error) {
        cleanupFailures.push(error);
      }
    };
    const cleanup = (async () => {
      await retain(async () => {
        await outcome;
      });
      await retain(() => {
        armed?.dispose();
        return Promise.resolve();
      });
      try {
        client?.release(true);
      } catch (error) {
        cleanupFailures.push(error);
      }
      await retain(async () => {
        if (before !== undefined) expect(await snapshot(observer)).toEqual(before);
      });
      await Promise.all([retain(() => pool.end()), retain(() => observer.end())]);
    })();
    const cleaned = await Promise.race([
      cleanup.then(() => true),
      delay(12_000, false, { ref: false }),
    ]);
    if (!cleaned) {
      try {
        assert.fail("CLEANUP: owned rollback-ACK fixture did not close within12s");
      } catch (error) {
        cleanupFailures.push(error);
      }
    }
  }
  const failures = [...(primary === undefined ? [] : [primary.error]), ...cleanupFailures];
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, "Rollback-ACK behavior/state/cleanup failed");
}
