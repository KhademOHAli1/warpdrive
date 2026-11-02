import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { PgTransaction } from "drizzle-orm/pg-core";
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { users } from "@/db/schema/identity";
import { makeTestDb } from "@/test/db";
import { err, ok } from "@/types/result";
import { runAuthorityTransactionCandidate } from "./authorityTransactionCandidate";
import {
  advisoryLocks,
  candidateSpec,
  closeHeldFixture,
  configuredCommit,
  deferredCommitFailure,
  heldTransaction,
  seedActor,
  settingsQuery,
  userValues,
  waitForEntry,
  waitForSettlement,
  waitForWaiter,
} from "./authorityTransactionCandidate.test-support";

const unavailable = { ok: false, error: "authority_transaction_unavailable" };

describe("isolated real-PG authority transaction candidate", () => {
  it("overrides ambient isolation, applies LOCAL timeouts, commits and restores session defaults", async () => {
    const h = await makeTestDb();
    try {
      const observed = await configuredCommit(h);
      expect(observed.before[0]?.isolation).toBe("repeatable read");
      expect(observed.receivedSignal).toBe(observed.signal);
      expect(observed.result).toEqual({
        ok: true,
        value: { isolation: "read committed", lockMs: 1_500, statementMs: 3_000, idleMs: 5_000 },
      });
      expect(observed.committed).toEqual([{ id: observed.id }]);
      expect(observed.after).toEqual(observed.before);
    } finally {
      await h.close();
    }
  });

  it("rolls back prior SQL and preserves an exact business error value", async () => {
    const h = await makeTestDb();
    try {
      const id = randomUUID();
      const failure = err({ code: "business_denied", correlation: id });
      const result = await runAuthorityTransactionCandidate(
        h.pool,
        candidateSpec("exclusive"),
        new AbortController().signal,
        async (tx) => {
          await tx.insert(users).values(userValues(id));
          return failure;
        },
      );
      expect(result).toEqual(failure);
      if (!result.ok) expect(result.error).toBe(failure.error);
      expect(await h.db.select({ id: users.id }).from(users).where(eq(users.id, id))).toEqual([]);
    } finally {
      await h.close();
    }
  });

  it("conservatively classifies a deferred constraint failure at COMMIT as unknown", async () => {
    const h = await makeTestDb();
    try {
      const observed = await deferredCommitFailure(h);
      expect(observed.operationEntered).toBe(true);
      expect(observed.operationCompleted).toBe(true);
      expect(observed.result).toEqual({ ok: false, error: "authority_commit_outcome_unknown" });
      expect(observed.remaining).toEqual([]);
    } finally {
      await h.close();
    }
  });

  it("allows two shared holders to overlap on the exact synthetic key", async () => {
    const h = await makeTestDb();
    const handles: ReturnType<typeof heldTransaction>[] = [];
    try {
      const spec = candidateSpec("shared");
      const first = heldTransaction(h, spec);
      handles.push(first);
      expect(await waitForEntry(first)).toEqual({ kind: "entered" });
      const second = heldTransaction(h, spec);
      handles.push(second);
      expect(await waitForEntry(second)).toEqual({ kind: "entered" });
      expect(
        (await advisoryLocks(h, spec)).filter((lock) => lock.granted && lock.mode === "ShareLock"),
      ).toHaveLength(2);
      first.release.open();
      second.release.open();
      expect(await Promise.all([first.run, second.run])).toEqual([ok("held"), ok("held")]);
    } finally {
      await closeHeldFixture(h, handles);
    }
  });

  it.each(["shared", "exclusive"] as const)(
    "keeps %s work behind an exclusive holder",
    async (mode) => {
      const h = await makeTestDb();
      const handles: ReturnType<typeof heldTransaction>[] = [];
      try {
        const holder = heldTransaction(h, candidateSpec("exclusive"));
        handles.push(holder);
        expect(await waitForEntry(holder)).toEqual({ kind: "entered" });
        const spec = candidateSpec(mode);
        const waiter = heldTransaction(h, spec);
        handles.push(waiter);
        expect(await waitForWaiter(h, spec, waiter)).toEqual({ kind: "waiting" });
        expect(waiter.entered.isOpen()).toBe(false);
        holder.release.open();
        expect(await holder.run).toEqual(ok("held"));
        expect(await waitForEntry(waiter)).toEqual({ kind: "entered" });
        waiter.release.open();
        expect(await waiter.run).toEqual(ok("held"));
      } finally {
        await closeHeldFixture(h, handles);
      }
    },
  );

  it("reads revoked actor state after waiting behind the exclusive revoker", async () => {
    const h = await makeTestDb();
    const handles: ReturnType<typeof heldTransaction>[] = [];
    try {
      const id = await seedActor(h);
      const cached = await h.db
        .select({ active: users.isActive })
        .from(users)
        .where(eq(users.id, id));
      expect(cached).toEqual([{ active: true }]);
      const revoker = heldTransaction(h, candidateSpec("exclusive"), async (tx) => {
        await tx.update(users).set({ isActive: false }).where(eq(users.id, id));
        return ok(true);
      });
      handles.push(revoker);
      expect(await waitForEntry(revoker)).toEqual({ kind: "entered" });
      const spec = candidateSpec("shared");
      const request = heldTransaction(h, spec, async (tx) => {
        const [current] = await tx
          .select({ active: users.isActive })
          .from(users)
          .where(eq(users.id, id));
        if (current?.active !== true) return err("actor_inactive");
        await tx.update(users).set({ name: "incorrectly_admitted" }).where(eq(users.id, id));
        return ok(true);
      });
      handles.push(request);
      expect(await waitForWaiter(h, spec, request)).toEqual({ kind: "waiting" });
      revoker.release.open();
      expect(await revoker.run).toEqual(ok("held"));
      expect(await waitForEntry(request)).toEqual({
        kind: "finished",
        value: err("actor_inactive"),
      });
      expect(request.entered.isOpen()).toBe(false);
      expect(
        await h.db
          .select({ name: users.name, active: users.isActive })
          .from(users)
          .where(eq(users.id, id)),
      ).toEqual([{ name: "before", active: false }]);
    } finally {
      await closeHeldFixture(h, handles);
    }
  });

  it("lets admitted shared work finish before an exclusive revoker rereads committed state", async () => {
    const h = await makeTestDb();
    const handles: ReturnType<typeof heldTransaction>[] = [];
    try {
      const id = await seedActor(h);
      const request = heldTransaction(h, candidateSpec("shared"), async (tx) => {
        const [current] = await tx
          .select({ active: users.isActive })
          .from(users)
          .where(eq(users.id, id));
        if (current?.active !== true) return err("actor_inactive");
        await tx.update(users).set({ name: "admitted_before_revoke" }).where(eq(users.id, id));
        return ok(true);
      });
      handles.push(request);
      expect(await waitForEntry(request)).toEqual({ kind: "entered" });
      let postWaitName: string | undefined;
      const spec = candidateSpec("exclusive");
      const revoker = heldTransaction(h, spec, async (tx) => {
        const [current] = await tx.select({ name: users.name }).from(users).where(eq(users.id, id));
        postWaitName = current?.name;
        await tx.update(users).set({ isActive: false }).where(eq(users.id, id));
        return ok(true);
      });
      handles.push(revoker);
      expect(await waitForWaiter(h, spec, revoker)).toEqual({ kind: "waiting" });
      request.release.open();
      expect(await request.run).toEqual(ok("held"));
      expect(await waitForEntry(revoker)).toEqual({ kind: "entered" });
      expect(postWaitName).toBe("admitted_before_revoke");
      revoker.release.open();
      expect(await revoker.run).toEqual(ok("held"));
      expect(
        await h.db
          .select({ name: users.name, active: users.isActive })
          .from(users)
          .where(eq(users.id, id)),
      ).toEqual([{ name: "admitted_before_revoke", active: false }]);
    } finally {
      await closeHeldFixture(h, handles);
    }
  });

  it("returns unavailable on a real lock timeout without entering business work", async () => {
    const h = await makeTestDb();
    const handles: ReturnType<typeof heldTransaction>[] = [];
    try {
      const holder = heldTransaction(h, candidateSpec("exclusive"));
      handles.push(holder);
      expect(await waitForEntry(holder)).toEqual({ kind: "entered" });
      const base = candidateSpec("shared");
      const spec = { ...base, sqlTimeouts: { ...base.sqlTimeouts, lockMs: 750 } };
      const waiter = heldTransaction(h, spec);
      handles.push(waiter);
      expect(await waitForWaiter(h, spec, waiter, 500)).toEqual({ kind: "waiting" });
      expect(await waitForSettlement(waiter)).toEqual({ kind: "finished", value: unavailable });
      expect(waiter.entered.isOpen()).toBe(false);
      holder.release.open();
      expect(await holder.run).toEqual(ok("held"));
      expect(await advisoryLocks(h, spec)).toEqual([]);
      expect((await h.pool.query("SELECT 1 AS usable")).rows).toEqual([{ usable: 1 }]);
    } finally {
      await closeHeldFixture(h, handles);
    }
  });

  it("propagates a pre-aborted signal without invoking business work", async () => {
    const h = await makeTestDb();
    try {
      const controller = new AbortController();
      controller.abort();
      let called = false;
      await expect(
        runAuthorityTransactionCandidate(h.pool, candidateSpec("shared"), controller.signal, () => {
          called = true;
          return Promise.resolve(ok("unexpected"));
        }),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(called).toBe(false);
      expect(await advisoryLocks(h, candidateSpec("shared"))).toEqual([]);
    } finally {
      await h.close();
    }
  });

  it("propagates abort after awaited SQL and rolls back before callback return can commit", async () => {
    const h = await makeTestDb();
    try {
      const id = randomUUID();
      const controller = new AbortController();
      await expect(
        runAuthorityTransactionCandidate(
          h.pool,
          candidateSpec("exclusive"),
          controller.signal,
          async (tx) => {
            await tx.insert(users).values(userValues(id));
            controller.abort();
            return ok("must_not_commit");
          },
        ),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(await h.db.select({ id: users.id }).from(users).where(eq(users.id, id))).toEqual([]);
      expect(await advisoryLocks(h, candidateSpec("exclusive"))).toEqual([]);
    } finally {
      await h.close();
    }
  });

  it("rejects an actual PgTransaction without changing its settings or entering a savepoint", async () => {
    const h = await makeTestDb();
    try {
      await h.db.transaction(async (tx) => {
        expect(tx).toBeInstanceOf(PgTransaction);
        const before = await tx.execute(sql.raw(settingsQuery));
        let called = false;
        const result = await runAuthorityTransactionCandidate(
          tx as unknown as Pool,
          candidateSpec("exclusive"),
          new AbortController().signal,
          () => {
            called = true;
            return Promise.resolve(ok("nested"));
          },
        );
        expect(result).toEqual(unavailable);
        expect(called).toBe(false);
        expect((await tx.execute(sql.raw(settingsQuery))).rows).toEqual(before.rows);
        expect(await advisoryLocks(h, candidateSpec("exclusive"))).toEqual([]);
      });
    } finally {
      await h.close();
    }
  });
});
