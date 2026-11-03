import { randomBytes, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import { hashSessionCredential } from "@/features/auth/better/sessionToken";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import { makeTestDb, type TestDb } from "@/test/db";
import { err, ok } from "@/types/result";
import { withCalendarActor } from "./calendarNativeAuthority";
import { readCalendarRequestSession } from "./calendarRequestSession";

// The cookie API is injected here; PostgreSQL, parser/hash and authority are
// real. This is not an HTTP/secure-cookie/browser acceptance claim.
const request = vi.hoisted((): { value: string | undefined } => ({ value: undefined }));
vi.mock("next/headers", async () => {
  const { AUTH_SESSION_COOKIE } = await import("@/features/auth/better/sessionToken");
  return {
    cookies: () =>
      Promise.resolve({
        get: (name: string) =>
          name !== AUTH_SESSION_COOKIE || request.value === undefined
            ? undefined
            : { name, value: request.value },
      }),
  };
});
const { activities, activityTypes, authPolicies, authUsers, sessions } = schema;
let h: TestDb;
let commandClient: PoolClient | undefined;
let commandDb: Db;
let commandPid: number;
const signal = () => AbortSignal.timeout(10_000);
beforeEach(async () => {
  h = await makeTestDb();
  commandClient = await h.pool.connect();
  commandDb = drizzle(commandClient, { schema });
  commandPid = await backendPid(commandDb);
});
afterEach(async () => {
  request.value = undefined;
  try {
    await commandClient?.query("ROLLBACK");
  } finally {
    commandClient?.release();
    commandClient = undefined;
    await h.close();
  }
});

function invariant(message: string): never {
  throw new AppError(ERROR_IDS.DB_INVARIANT, message);
}

async function fixture() {
  // Password assurance is valid for this verified non-admin until a control
  // changes MFA policy. An admin would already be denied before that change.
  const user = await seedUser(h.db, { isAdmin: false });
  await h.db
    .insert(authUsers)
    .values({ id: user.id, email: user.email, name: user.name, emailVerified: true });
  const token = randomBytes(32).toString("base64url");
  const [row] = await h.db
    .insert(sessions)
    .values({
      userId: user.id,
      tokenHash: hashSessionCredential(token),
      authMethod: "password",
      assurance: "password",
      expiresAt: sql`clock_timestamp() + interval '1 hour'`,
      lastSeenAt: sql`clock_timestamp() - interval '1 minute'`,
      freshAuthenticatedAt: sql`clock_timestamp() - interval '3 days'`,
    })
    .returning();
  if (row === undefined) invariant("Calendar session fixture missing");
  request.value = `${token}.opaque-signature`;
  return { user, row, token };
}
async function boundReference() {
  const who = await readCalendarRequestSession(h.db, signal());
  if (who === null) invariant("Credential binding missing");
  return who;
}
function latch() {
  let release: () => void = () => invariant("Latch not initialized");
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
function settled<T>(work: Promise<T>): Promise<{ value: T } | { error: unknown }> {
  return work.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
}
async function backendPid(db: Db): Promise<number> {
  const result = await db.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
  return result.rows[0]?.pid ?? invariant("Owned backend missing");
}
async function waitForOwnedWaiter(
  blocker: number,
  kind: "authority" | "activity",
): Promise<number> {
  const deadline = Date.now() + 1_500;
  while (Date.now() < deadline) {
    const result = await h.pool.query<{ pid: number }>(
      `SELECT pid FROM pg_locks WHERE NOT granted
      AND pid=$1 AND $2=ANY(pg_blocking_pids(pid))
      AND (($3='activity' AND locktype IN ('transactionid','tuple')) OR ($3='authority' AND locktype='advisory'
        AND database=(SELECT oid FROM pg_database WHERE datname=current_database())
        AND classid=((hashtext('warpdrive-current-authority')::bigint & 4294967295)::oid)
        AND objid=((hashtext('actor-v1')::bigint & 4294967295)::oid) AND objsubid=2))`,
      [commandPid, blocker, kind],
    );
    if (result.rows[0] !== undefined) return result.rows[0].pid;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  invariant(`No owned Calendar ${kind} waiter observed`);
}
async function expectCommandLocksReleased() {
  const retired = await h.pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM pg_locks
    WHERE pid=$1 AND locktype='advisory'`,
    [commandPid],
  );
  expect(retired.rows[0]?.count).toBe(0);
}
async function sessionExpired(id: string): Promise<boolean> {
  const result = await h.pool.query<{ expired: boolean }>(
    `SELECT clock_timestamp() >= expires_at AS expired FROM sessions WHERE id=$1`,
    [id],
  );
  return result.rows[0]?.expired ?? invariant("Expiry clock fixture missing");
}

it("binds only the hashed injected cookie credential and leaves modern idle/freshness fields unchanged", async () => {
  const f = await fixture();
  const who = await boundReference();
  expect(who).toEqual({ userId: f.user.id, sessionId: f.row.id });
  for (let n = 0; n < 3; n++) {
    expect(
      await withCalendarActor(
        commandDb,
        await boundReference(),
        f.user.id,
        signal(),
        (_tx, actor) => Promise.resolve(ok(actor.id)),
      ),
    ).toEqual({ ok: true, value: f.user.id });
  }
  const [after] = await h.db.select().from(sessions).where(eq(sessions.id, f.row.id));
  expect(after).toEqual(f.row);
  request.value = f.row.id;
  expect(await readCalendarRequestSession(h.db, signal())).toBeNull();
  request.value = randomBytes(32).toString("base64url");
  expect(await readCalendarRequestSession(h.db, signal())).toBeNull();
});
it("rejects an account mismatch before the mutation callback", async () => {
  await fixture();
  let effects = 0;
  const result = await withCalendarActor(
    commandDb,
    await boundReference(),
    randomUUID(),
    signal(),
    () => {
      effects++;
      return Promise.resolve(ok(true));
    },
  );
  expect(result.ok ? null : result.error.id).toBe(ERROR_IDS.AUTH_SESSION_DEAD);
  expect(effects).toBe(0);
});
it.each(["revoked", "expired", "mfa", "idle", "absolute", "policy"] as const)(
  "does not revive a %s credential while resolving a real authority wait",
  async (kind) => {
    const f = await fixture();
    const who = await boundReference();
    expect(
      await withCalendarActor(commandDb, who, f.user.id, signal(), (_tx, actor) =>
        Promise.resolve(ok(actor.id)),
      ),
    ).toEqual({ ok: true, value: f.user.id });
    const entered = latch();
    const release = latch();
    let holderPid = 0;
    let invalidSession: typeof sessions.$inferSelect | undefined;
    const holder = settled(
      withCurrentAuthority(h.db, "write", signal(), async (tx) => {
        holderPid = await backendPid(tx);
        if (kind === "revoked")
          await tx
            .update(sessions)
            .set({ revokedAt: sql`clock_timestamp()` })
            .where(eq(sessions.id, f.row.id));
        if (kind === "expired")
          await tx
            .update(sessions)
            .set({ expiresAt: sql`clock_timestamp() - interval '1 second'` })
            .where(eq(sessions.id, f.row.id));
        if (kind === "mfa")
          await tx
            .update(authUsers)
            .set({ twoFactorEnabled: true })
            .where(eq(authUsers.id, f.user.id));
        if (kind === "idle")
          await tx
            .update(sessions)
            .set({ lastSeenAt: sql`clock_timestamp() - interval '31 minutes'` })
            .where(eq(sessions.id, f.row.id));
        if (kind === "absolute")
          await tx
            .update(sessions)
            .set({ createdAt: sql`clock_timestamp() - interval '169 hours'` })
            .where(eq(sessions.id, f.row.id));
        if (kind === "policy")
          await tx
            .insert(authPolicies)
            .values({ id: true, requireMfaForAll: true })
            .onConflictDoUpdate({ target: authPolicies.id, set: { requireMfaForAll: true } });
        [invalidSession] = await tx.select().from(sessions).where(eq(sessions.id, f.row.id));
        if (invalidSession === undefined) invariant("Blocked-fence session fixture missing");
        entered.release();
        await release.promise;
      }),
    );
    let effects = 0;
    let command: Promise<unknown> | undefined;
    try {
      await Promise.race([
        entered.promise,
        holder.then(() => invariant("Authority holder settled before entry")),
      ]);
      command = settled(
        withCalendarActor(commandDb, who, f.user.id, signal(), () => {
          effects++;
          return Promise.resolve(ok(true));
        }),
      );
      expect(await waitForOwnedWaiter(holderPid, "authority")).toBe(commandPid);
      release.release();
      expect(await holder).toEqual({ value: undefined });
      expect(await command).toMatchObject({
        value: { ok: false, error: { id: ERROR_IDS.AUTH_SESSION_DEAD } },
      });
      expect(effects).toBe(0);
      const [after] = await h.db.select().from(sessions).where(eq(sessions.id, f.row.id));
      expect(after).toEqual(invalidSession);
      expect(after?.freshAuthenticatedAt).toEqual(f.row.freshAuthenticatedAt);
      expect(after?.lastSeenAt).toEqual(kind === "idle" ? expect.any(Date) : f.row.lastSeenAt);
      if (kind === "idle")
        expect(after?.lastSeenAt.getTime()).toBeLessThan(f.row.lastSeenAt.getTime());
      await expectCommandLocksReleased();
    } finally {
      release.release();
      await Promise.all([holder, command]);
    }
  },
);
it("rolls back a callback write when the credential expires during a real activity-row wait", async () => {
  const f = await fixture();
  const [type] = await h.db.select().from(activityTypes).where(eq(activityTypes.key, "meeting"));
  if (type === undefined) invariant("Meeting fixture missing");
  const [activity] = await h.db
    .insert(activities)
    .values({
      typeId: type.id,
      subject: "Before expiry wait",
      ownerId: f.user.id,
      assigneeId: f.user.id,
    })
    .returning();
  if (activity === undefined) invariant("Expiry activity fixture missing");
  const entered = latch();
  const release = latch();
  let holderPid = 0;
  const holder = settled(
    withCurrentAuthority(h.db, "read", signal(), async (tx) => {
      holderPid = await backendPid(tx);
      await tx.select().from(activities).where(eq(activities.id, activity.id)).for("update");
      entered.release();
      await release.promise;
    }),
  );
  let command: Promise<unknown> | undefined;
  let effects = 0;
  try {
    await Promise.race([
      entered.promise,
      holder.then(() => invariant("Activity holder settled before entry")),
    ]);
    // Shorten the fixture expiry once before the command. The wait crosses real
    // database time without reviving the session or touching idle/freshness.
    const [before] = await h.db
      .update(sessions)
      .set({ expiresAt: sql`clock_timestamp() + interval '1 second'` })
      .where(eq(sessions.id, f.row.id))
      .returning();
    if (before === undefined) invariant("Expiry session fixture missing");
    expect(before.expiresAt.getTime()).toBeLessThan(f.row.expiresAt.getTime());
    expect(before).toEqual({ ...f.row, expiresAt: before.expiresAt });
    command = settled(
      withCalendarActor(commandDb, await boundReference(), f.user.id, signal(), async (tx) => {
        await tx.select().from(activities).where(eq(activities.id, activity.id)).for("update");
        const clock = await tx.execute<{ frozen_live: boolean; expired: boolean }>(sql`
        SELECT transaction_timestamp() < expires_at AS frozen_live, clock_timestamp() >= expires_at AS expired
        FROM sessions WHERE id=${f.row.id}`);
        expect(clock.rows[0]).toEqual({ frozen_live: true, expired: true });
        await tx
          .update(activities)
          .set({ subject: "Must roll back after expiry" })
          .where(eq(activities.id, activity.id));
        effects++;
        return ok(true);
      }),
    );
    expect(await waitForOwnedWaiter(holderPid, "activity")).toBe(commandPid);
    expect(await sessionExpired(f.row.id)).toBe(false);
    const deadline = Date.now() + 1_500;
    while (!(await sessionExpired(f.row.id)) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(await sessionExpired(f.row.id)).toBe(true);
    expect(await waitForOwnedWaiter(holderPid, "activity")).toBe(commandPid);
    release.release();
    expect(await holder).toEqual({ value: undefined });
    expect(await command).toMatchObject({
      value: { ok: false, error: { id: ERROR_IDS.AUTH_SESSION_DEAD } },
    });
    expect(effects).toBe(1);
    const [after] = await h.db.select().from(sessions).where(eq(sessions.id, f.row.id));
    expect(after).toEqual(before);
    expect(await h.db.select().from(activities).where(eq(activities.id, activity.id))).toEqual([
      activity,
    ]);
    await expectCommandLocksReleased();
  } finally {
    release.release();
    await Promise.all([holder, command]);
  }
});
it("rolls back an actual callback effect before returning a domain failure", async () => {
  const f = await fixture();
  const [type] = await h.db.select().from(activityTypes).where(eq(activityTypes.key, "meeting"));
  if (type === undefined) invariant("Meeting fixture missing");
  const result = await withCalendarActor(
    commandDb,
    await boundReference(),
    f.user.id,
    signal(),
    async (tx) => {
      await tx.insert(activities).values({
        typeId: type.id,
        subject: "Must roll back",
        ownerId: f.user.id,
        assigneeId: f.user.id,
      });
      return err(
        new AppError(ERROR_IDS.ACTIVITY_NATIVE_INPUT_INVALID, "Controlled failure after write"),
      );
    },
  );
  expect(result.ok ? null : result.error.id).toBe(ERROR_IDS.ACTIVITY_NATIVE_INPUT_INVALID);
  expect(await h.db.select().from(activities)).toHaveLength(0);
});
