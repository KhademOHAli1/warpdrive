import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { authAccounts, authRateLimits, authSecurityEvents, sessions, users } from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { createBetterAuth, rebindBetterAuth } from "./better/auth";
import { LAST_METHOD_PASSWORD, lastMethodFixture } from "./better/lastAuthMethod.test-helpers";
import { nativeAuthGateway } from "./better/nativeGateway";
import { runSecurityAction } from "./better/securityActions";
import {
  AUTH_SESSION_COOKIE,
  hashSessionCredential,
  readCookie,
  sessionTokenFromCookie,
} from "./better/sessionToken";
import { withCurrentAuthority } from "./currentAuthority";

let h: TestDb;
let observer: PoolClient;
const signal = () => AbortSignal.timeout(10_000);
beforeAll(async () => {
  h = await makeTestDb();
  observer = await h.pool.connect();
});
afterAll(async () => {
  observer.release();
  await h.close();
});

function latch() {
  let resolve: () => void = () => {
    throw new Error("latch not initialized");
  };
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function backendRetired(pid: number) {
  const result = await observer.query<{ locks: number; in_transaction: boolean }>(
    `
    SELECT (SELECT count(*)::int FROM pg_locks WHERE pid=$1 AND locktype='advisory') AS locks,
      EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND xact_start IS NOT NULL) AS in_transaction
  `,
    [pid],
  );
  expect(result.rows[0]).toEqual({ locks: 0, in_transaction: false });
}

async function waitForFenceWaiter() {
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    const result = await observer.query<{ pid: number }>(`
      SELECT pid FROM pg_locks WHERE locktype='advisory' AND NOT granted
        AND database=(SELECT oid FROM pg_database WHERE datname=current_database())
        AND classid=((hashtext('warpdrive-current-authority')::bigint & 4294967295)::oid)
        AND objid=((hashtext('actor-v1')::bigint & 4294967295)::oid) AND objsubid=2
    `);
    if (result.rows[0] !== undefined) return result.rows[0].pid;
    await new Promise((done) => setTimeout(done, 10));
  }
  throw new Error("no PostgreSQL authority waiter observed");
}

test("actual READ COMMITTED fence reuses nested modes and refuses a shared upgrade", async () => {
  let pid = 0;
  await withCurrentAuthority(h.db, "read", signal(), async (tx) => {
    pid = (await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)).rows[0]!.pid;
    await withCurrentAuthority(tx, "read", signal(), async (nested) => {
      expect((await nested.execute<{ value: number }>(sql`SELECT 1 AS value`)).rows[0]?.value).toBe(
        1,
      );
    });
    await expect(
      withCurrentAuthority(tx, "write", signal(), () => Promise.resolve()),
    ).rejects.toMatchObject({ id: "E_DB_001" });
  });
  await backendRetired(pid);
  await withCurrentAuthority(h.db, "write", signal(), async (tx) => {
    await withCurrentAuthority(tx, "read", signal(), () => Promise.resolve());
    await withCurrentAuthority(tx, "write", signal(), () => Promise.resolve());
  });
});

test("unwrapped inherited RC and REPEATABLE READ fail before a fence is requested", async () => {
  for (const isolationLevel of ["read committed", "repeatable read"] as const) {
    let pid = 0;
    await expect(
      h.db.transaction(
        async (tx) => {
          pid = (await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)).rows[0]!
            .pid;
          return withCurrentAuthority(tx, "read", signal(), () =>
            Promise.reject(new Error("must not run")),
          );
        },
        { isolationLevel },
      ),
    ).rejects.toMatchObject({ id: "E_DB_001" });
    await backendRetired(pid);
  }
});

test("write holder causes a real bounded lock timeout before callback effects; backend is reusable", async () => {
  const entered = latch();
  const release = latch();
  let holderPid = 0;
  const holder = withCurrentAuthority(h.db, "write", signal(), async (tx) => {
    holderPid = (await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)).rows[0]!
      .pid;
    entered.resolve();
    await release.promise;
  });
  await entered.promise;
  let called = false;
  let waiterPid = 0;
  const waiter = withCurrentAuthority(h.db, "read", signal(), () => {
    called = true;
    return Promise.resolve();
  });
  // Attach rejection handling before observing the blocked backend.
  const rejected = expect(waiter).rejects.toMatchObject({ cause: { code: "55P03" } });
  try {
    waiterPid = await waitForFenceWaiter();
    await rejected;
    expect(called).toBe(false);
    await backendRetired(waiterPid);
  } finally {
    release.resolve();
    await holder;
  }
  await backendRetired(holderPid);
  await withCurrentAuthority(h.db, "read", signal(), () => Promise.resolve());
}, 10_000);

test("abort after a blocked fence acquisition rolls back before callback; no abandoned transaction", async () => {
  const entered = latch();
  const release = latch();
  const holder = withCurrentAuthority(h.db, "write", signal(), async () => {
    entered.resolve();
    await release.promise;
  });
  await entered.promise;
  const controller = new AbortController();
  let called = false;
  const waiter = withCurrentAuthority(h.db, "read", controller.signal, () => {
    called = true;
    return Promise.resolve();
  });
  const rejected = expect(waiter).rejects.toMatchObject({ name: "AbortError" });
  let pid = 0;
  try {
    pid = await waitForFenceWaiter();
    controller.abort();
    release.resolve();
    await holder;
    await rejected;
    expect(called).toBe(false);
    await backendRetired(pid);
  } finally {
    release.resolve();
    await holder;
  }
});

test("callback failure rolls back effects, retains tighter SQL limits, and restores outer settings", async () => {
  const id = randomUUID();
  const failure = new Error("intentional authority rollback");
  let pid = 0;
  await expect(
    withCurrentAuthority(h.db, "write", signal(), async (tx) => {
      pid = (await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)).rows[0]!.pid;
      await tx.insert(users).values({ id, email: `${id}@example.com`, name: "Rollback" });
      throw failure;
    }),
  ).rejects.toBe(failure);
  expect(await h.db.select().from(users).where(eq(users.id, id))).toHaveLength(0);
  await backendRetired(pid);
  await withCurrentAuthority(h.db, "write", signal(), async (tx) => {
    await tx.execute(sql`SET LOCAL statement_timeout='500ms'`);
    await tx.execute(sql`SET LOCAL lock_timeout='100ms'`);
    await withCurrentAuthority(tx, "read", signal(), async (nested) => {
      const settings = await nested.execute<{ statement: string; lock: string }>(sql`
        SELECT current_setting('statement_timeout') AS statement, current_setting('lock_timeout') AS lock
      `);
      expect(settings.rows[0]).toEqual({ statement: "500ms", lock: "100ms" });
    });
    expect(
      (
        await tx.execute<{ value: string }>(
          sql`SELECT current_setting('statement_timeout') AS value`,
        )
      ).rows[0]?.value,
    ).toBe("500ms");
  });
});

test("an interrupted callback rolls back its completed local write before returning", async () => {
  const controller = new AbortController();
  const id = randomUUID();
  let pid = 0;
  await expect(
    withCurrentAuthority(h.db, "write", controller.signal, async (tx) => {
      pid = (await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)).rows[0]!.pid;
      await tx.insert(users).values({ id, email: `${id}@example.com`, name: "Interrupted" });
      controller.abort();
    }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(await h.db.select().from(users).where(eq(users.id, id))).toHaveLength(0);
  await backendRetired(pid);
});

test("a tighter real statement timeout rolls back a completed write and retires its backend", async () => {
  const id = randomUUID();
  let pid = 0;
  await expect(
    withCurrentAuthority(h.db, "write", signal(), async (tx) => {
      pid = (await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)).rows[0]!.pid;
      await tx.execute(sql`SET LOCAL statement_timeout='50ms'`);
      await withCurrentAuthority(tx, "read", signal(), async (nested) => {
        await nested
          .insert(users)
          .values({ id, email: `${id}@example.com`, name: "Statement timeout" });
        await nested.execute(sql`SELECT pg_sleep(0.15)`);
      });
    }),
  ).rejects.toMatchObject({ cause: { code: "57014" } });
  expect(await h.db.select().from(users).where(eq(users.id, id))).toHaveLength(0);
  await backendRetired(pid);
});

test("real configured BetterAuth adapter/middleware and security effects share rollback", async () => {
  const f = await lastMethodFixture(h, false);
  const config = { ...f.config, AUTH_ALLOW_PASSKEY: false };
  const auth = createBetterAuth(h.db, config);
  config.AUTH_ALLOW_PASSKEY = true;
  const token = sessionTokenFromCookie(readCookie(f.jar.headers(), AUTH_SESSION_COOKIE)!)!;
  const digest = hashSessionCredential(token);
  const old = new Date(Date.now() - 60_000);
  await h.db
    .update(sessions)
    .set({ freshAuthenticatedAt: old })
    .where(eq(sessions.tokenHash, digest));
  const limitsBefore = await h.db.select().from(authRateLimits).orderBy(authRateLimits.key);
  const auditBefore = await h.db.select().from(authSecurityEvents).orderBy(authSecurityEvents.id);
  const [accountBefore] = await h.db
    .select()
    .from(authAccounts)
    .where(and(eq(authAccounts.userId, f.userId), eq(authAccounts.providerId, "credential")));
  const transactionPassword = `${LAST_METHOD_PASSWORD}-transaction-only`;
  const transactionHash = await (await auth.$context).password.hash(transactionPassword);
  const failure = new Error("rollback all real security effects");
  await expect(
    withCurrentAuthority(h.db, "write", signal(), async (tx) => {
      // The root instance cannot see this credential until COMMIT. Real verification must
      // read through the rebound adapter on this transaction, not a second pool connection.
      await tx
        .update(authAccounts)
        .set({ password: transactionHash })
        .where(and(eq(authAccounts.userId, f.userId), eq(authAccounts.providerId, "credential")));
      const rebound = rebindBetterAuth(auth, tx);
      expect(rebound.options.plugins?.some((plugin) => plugin.id === "passkey")).toBe(false);
      expect(
        await runSecurityAction(
          tx,
          auth,
          f.jar.headers(),
          { action: "reauthenticate", password: transactionPassword },
          signal(),
        ),
      ).toEqual({ ok: true, data: {} });
      throw failure;
    }),
  ).rejects.toBe(failure);
  const [after] = await h.db.select().from(sessions).where(eq(sessions.tokenHash, digest));
  expect(after?.freshAuthenticatedAt).toEqual(old);
  expect(await h.db.select().from(authRateLimits).orderBy(authRateLimits.key)).toEqual(
    limitsBefore,
  );
  expect(await h.db.select().from(authSecurityEvents).orderBy(authSecurityEvents.id)).toEqual(
    auditBefore,
  );
  expect(
    (await h.db.select().from(authAccounts).where(eq(authAccounts.id, accountBefore!.id)))[0],
  ).toEqual(accountBefore);
  const unowned = { ...auth };
  await expect(
    runSecurityAction(
      h.db,
      unowned,
      f.jar.headers(),
      { action: "reauthenticate", password: LAST_METHOD_PASSWORD },
      signal(),
    ),
  ).rejects.toMatchObject({ id: "E_DB_001" });
  expect(await h.db.select().from(authRateLimits).orderBy(authRateLimits.key)).toEqual(
    limitsBefore,
  );
});

test("real native GET session handler waits for authority before refreshing lastSeenAt", async () => {
  const f = await lastMethodFixture(h, false);
  const token = sessionTokenFromCookie(readCookie(f.jar.headers(), AUTH_SESSION_COOKIE)!)!;
  const digest = hashSessionCredential(token);
  const old = new Date(Date.now() - 120_000);
  await h.db.update(sessions).set({ lastSeenAt: old }).where(eq(sessions.tokenHash, digest));
  const entered = latch();
  const release = latch();
  const reader = withCurrentAuthority(h.db, "read", signal(), async () => {
    entered.resolve();
    await release.promise;
  });
  await entered.promise;
  const response = nativeAuthGateway(
    h.db,
    new Request(`${f.config.BASE_URL}/api/auth/get-session`, {
      method: "GET",
      headers: f.jar.headers(),
    }),
    f.config,
  );
  try {
    await waitForFenceWaiter();
    const [whileHeld] = await h.db.select().from(sessions).where(eq(sessions.tokenHash, digest));
    expect(whileHeld?.lastSeenAt).toEqual(old);
  } finally {
    release.resolve();
    await reader;
  }
  expect((await response).status).toBe(200);
  const [after] = await h.db.select().from(sessions).where(eq(sessions.tokenHash, digest));
  expect(after!.lastSeenAt.getTime()).toBeGreaterThan(old.getTime());
});

test("an unfinished anonymous body owns no authority fence and cannot block a real reader or writer", async () => {
  const reading = latch();
  const client = new AbortController();
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start: (controller) => controller.enqueue(new TextEncoder().encode('{"email":')),
    pull: () => {
      reading.resolve();
    },
    cancel: () => {
      cancelled = true;
    },
  });
  const pending = nativeAuthGateway(
    h.db,
    new Request("https://app.example.com/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: client.signal,
      ...{ duplex: "half" },
    }),
  );
  try {
    await reading.promise;
    expect(cancelled).toBe(false);
    const locks = await observer.query<{
      count: number;
    }>(`SELECT count(*)::int AS count FROM pg_locks
      WHERE database=(SELECT oid FROM pg_database WHERE datname=current_database())
        AND locktype='advisory' AND objsubid=2
        AND classid=((hashtext('warpdrive-current-authority')::bigint & 4294967295)::oid)
        AND objid=((hashtext('actor-v1')::bigint & 4294967295)::oid)`);
    expect(locks.rows[0]?.count).toBe(0);
    for (const mode of ["read", "write"] as const) {
      let pid = 0;
      await withCurrentAuthority(h.db, mode, signal(), async (tx) => {
        pid = (await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)).rows[0]!.pid;
      });
      await backendRetired(pid);
    }
    expect(cancelled).toBe(false);
  } finally {
    client.abort();
  }
  expect((await pending).status).toBe(408);
  expect(cancelled).toBe(true);
  expect(body.locked).toBe(false);
});
