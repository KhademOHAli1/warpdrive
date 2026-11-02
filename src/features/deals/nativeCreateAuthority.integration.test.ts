import { sql } from "drizzle-orm";
import type { PoolClient } from "pg";
import { expect, test } from "vitest";
import { env } from "@/config/env";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { seedUser } from "@/db/testing/factories";
import { logoutCurrentRequest } from "@/features/auth/better/logoutCurrentRequest";
import { mintCsrfToken } from "@/features/auth/csrf";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import { revokeManagedSession } from "@/features/auth/management/userDetails";
import { hydrateActor } from "@/server/hydrateActor";
import { makeTestDb, type TestDb } from "@/test/db";
import { createNativeDeal } from "./nativeCreate";
import {
  type CreationFixture,
  creationEffects,
  creationFixture,
  creationSignal,
} from "./nativeCreate.test-helpers";

function latch() {
  let resolve: () => void = () => {
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Uninitialized test latch");
  };
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function waiter(observer: PoolClient, objsubid: 1 | 2) {
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    const result = await observer.query<{ pid: number }>(
      "SELECT pid FROM pg_locks WHERE locktype='advisory' AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND NOT granted AND objsubid=$1",
      [objsubid],
    );
    if (result.rows[0]) return result.rows[0].pid;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new AppError(ERROR_IDS.DB_INVARIANT, "No actual advisory waiter observed");
}
async function revoker(h: TestDb, f: CreationFixture, kind: "logout" | "admin_revoke") {
  const adminUser = await seedUser(h.db, { isAdmin: true });
  const admin = await hydrateActor(h.db, adminUser.id, creationSignal());
  if (admin === null) throw new AppError(ERROR_IDS.DB_INVARIANT, "Missing actual admin");
  return async (db = h.db) => {
    if (kind === "admin_revoke") {
      expect(
        await revokeManagedSession(db, admin, f.user.id, f.who.sessionId, creationSignal()),
      ).toEqual({ ok: true, value: true });
      return;
    }
    const token = mintCsrfToken();
    const response = await logoutCurrentRequest(
      db,
      new Request(`${env.BASE_URL}/api/auth/logout`, {
        method: "POST",
        headers: {
          Origin: new URL(env.BASE_URL).origin,
          Host: new URL(env.BASE_URL).host,
          "Content-Type": "application/x-www-form-urlencoded",
          "Sec-Fetch-Site": "same-origin",
          Cookie: `wd_sid=${f.cookie}; wd_csrf=${token}`,
        },
        body: new URLSearchParams({ csrfToken: token }),
      }),
      creationSignal(),
    );
    expect(response.status).toBe(303);
  };
}

test.each(["logout", "admin_revoke"] as const)(
  "create preceding actual %s commits once before session revocation",
  async (kind) => {
    const h = await makeTestDb();
    let observer: PoolClient | undefined;
    const tasks: Promise<unknown>[] = [];
    try {
      const f = await creationFixture(h),
        revoke = await revoker(h, f, kind);
      observer = await h.pool.connect();
      await observer.query("BEGIN");
      await observer.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `warpdrive.native.deal-create.v1:${f.user.id}:${f.input.creationOperationId}`,
      ]);
      const create = createNativeDeal(h.db, f.who, f.input, creationSignal());
      tasks.push(create);
      const createPid = await waiter(observer, 1);
      const writer = revoke();
      tasks.push(writer);
      const writerPid = await waiter(observer, 2);
      expect(writerPid).not.toBe(createPid);
      expect(await creationEffects(h, f)).toEqual({
        deals: 0,
        receipts: 0,
        links: 0,
        labels: 0,
        channel: 0,
      });
      await observer.query("COMMIT");
      expect((await create).ok).toBe(true);
      await writer;
      expect(await creationEffects(h, f)).toEqual({
        deals: 1,
        receipts: 1,
        links: 1,
        labels: 1,
        channel: 1,
      });
      expect(await createNativeDeal(h.db, f.who, f.input, creationSignal())).toMatchObject({
        ok: false,
        error: { id: "E_AUTH_003" },
      });
      const remaining = await observer.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM pg_locks WHERE pid=ANY($1::int[]) AND locktype='advisory'",
        [[createPid, writerPid]],
      );
      expect(remaining.rows[0]?.count).toBe(0);
    } finally {
      if (observer) {
        await observer.query("ROLLBACK");
        observer.release();
      }
      await Promise.allSettled(tasks);
      await h.close();
    }
  },
);

test.each(["logout", "admin_revoke"] as const)(
  "actual %s preceding create denies all domain/receipt effects",
  async (kind) => {
    const h = await makeTestDb(),
      entered = latch(),
      finish = latch();
    let observer: PoolClient | undefined;
    const tasks: Promise<unknown>[] = [];
    try {
      const f = await creationFixture(h),
        revoke = await revoker(h, f, kind);
      observer = await h.pool.connect();
      let writerPid = 0;
      const writer = withCurrentAuthority(h.db, "write", creationSignal(), async (tx) => {
        writerPid =
          (await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)).rows[0]?.pid ??
          0;
        await revoke(tx);
        entered.resolve();
        await finish.promise;
      });
      tasks.push(writer);
      await entered.promise;
      const create = createNativeDeal(h.db, f.who, f.input, creationSignal());
      tasks.push(create);
      const createPid = await waiter(observer, 2);
      expect(createPid).not.toBe(writerPid);
      expect(await creationEffects(h, f)).toEqual({
        deals: 0,
        receipts: 0,
        links: 0,
        labels: 0,
        channel: 0,
      });
      finish.resolve();
      await writer;
      expect(await create).toMatchObject({ ok: false, error: { id: "E_AUTH_003" } });
      expect(await creationEffects(h, f)).toEqual({
        deals: 0,
        receipts: 0,
        links: 0,
        labels: 0,
        channel: 0,
      });
      const remaining = await observer.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM pg_locks WHERE pid=ANY($1::int[]) AND locktype='advisory'",
        [[createPid, writerPid]],
      );
      expect(remaining.rows[0]?.count).toBe(0);
    } finally {
      finish.resolve();
      await Promise.allSettled(tasks);
      observer?.release();
      await h.close();
    }
  },
);
