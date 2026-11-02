import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { authPolicies, authUsers, permissionSets, sessions, users } from "@/db/schema";
import { setUserActive } from "@/features/identity/users.service";
import { hydrateActor } from "@/server/hydrateActor";
import { makeTestDb, type TestDb } from "@/test/db";
import { withCurrentAuthority } from "./currentAuthority";
import { currentNativeActor } from "./currentNativeActor";

let h: TestDb;
const signal = () => AbortSignal.timeout(10_000);
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});

async function fixture(modern: boolean) {
  const userId = randomUUID();
  await h.db
    .insert(users)
    .values({ id: userId, email: `${userId}@example.com`, name: "Native authority" });
  if (modern)
    await h.db.insert(authUsers).values({
      id: userId,
      email: `${userId}@example.com`,
      name: "Native authority",
      emailVerified: true,
    });
  const [session] = await h.db
    .insert(sessions)
    .values({
      userId,
      tokenHash: randomUUID(),
      expiresAt: new Date(Date.now() + 60_000),
      authMethod: modern ? "password" : "legacy",
      assurance: modern ? "password" : "legacy",
      freshAuthenticatedAt: new Date(Date.now() - 24 * 3_600_000),
    })
    .returning();
  return { userId, sessionId: session!.id };
}

test("routine healthy legacy without auth_users and modern sessions work without fresh-auth or touches", async () => {
  for (const modern of [false, true]) {
    const who = await fixture(modern);
    const [before] = await h.db.select().from(sessions).where(eq(sessions.id, who.sessionId));
    const current = await withCurrentAuthority(h.db, "read", signal(), (tx) =>
      currentNativeActor(tx, who, signal()),
    );
    expect(current?.actor.id).toBe(who.userId);
    const [after] = await h.db.select().from(sessions).where(eq(sessions.id, who.sessionId));
    expect(after).toEqual(before);
  }
});

test("internal session reference is partitioned by user, requires held fence, and rejects revoked/inactive", async () => {
  const who = await fixture(false);
  await expect(currentNativeActor(h.db, who, signal())).rejects.toMatchObject({ id: "E_DB_001" });
  expect(
    await withCurrentAuthority(h.db, "read", signal(), (tx) =>
      currentNativeActor(
        tx,
        {
          ...who,
          userId: randomUUID(),
        },
        signal(),
      ),
    ),
  ).toBeNull();
  await h.db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, who.sessionId));
  expect(
    await withCurrentAuthority(h.db, "read", signal(), (tx) =>
      currentNativeActor(tx, who, signal()),
    ),
  ).toBeNull();
  await h.db.update(sessions).set({ revokedAt: null }).where(eq(sessions.id, who.sessionId));
  await h.db.update(users).set({ isActive: false }).where(eq(users.id, who.userId));
  expect(
    await withCurrentAuthority(h.db, "read", signal(), (tx) =>
      currentNativeActor(tx, who, signal()),
    ),
  ).toBeNull();
});

test("wall clock expiry after transaction start is rejected for supported legacy and modern sessions", async () => {
  for (const modern of [false, true]) {
    const who = await fixture(modern);
    await withCurrentAuthority(h.db, "read", signal(), async (tx) => {
      // Controlled fixture time, not an application writer: now() remains before this expiry.
      await tx.execute(
        sql`UPDATE sessions SET expires_at=clock_timestamp()+interval '40 milliseconds' WHERE id=${who.sessionId}`,
      );
      await tx.execute(sql`SELECT pg_sleep(0.07)`);
      expect(await currentNativeActor(tx, who, signal())).toBeNull();
    });
  }
});

test("modern policy retains verification, pending assurance, MFA, idle and absolute expiry checks", async () => {
  const cases = ["unverified", "pending", "mfa", "idle", "absolute", "missing-profile"] as const;
  for (const kind of cases) {
    const who = await fixture(true);
    if (kind === "unverified")
      await h.db
        .update(authUsers)
        .set({ emailVerified: false })
        .where(eq(authUsers.id, who.userId));
    if (kind === "pending")
      await h.db
        .update(sessions)
        .set({ assurance: "pending" })
        .where(eq(sessions.id, who.sessionId));
    if (kind === "mfa")
      await h.db
        .update(authUsers)
        .set({ twoFactorEnabled: true })
        .where(eq(authUsers.id, who.userId));
    if (kind === "idle")
      await h.db
        .update(sessions)
        .set({ lastSeenAt: new Date(Date.now() - 31 * 60_000) })
        .where(eq(sessions.id, who.sessionId));
    if (kind === "absolute")
      await h.db
        .update(sessions)
        .set({ createdAt: new Date(Date.now() - 169 * 3_600_000) })
        .where(eq(sessions.id, who.sessionId));
    if (kind === "missing-profile")
      await h.db.delete(authUsers).where(eq(authUsers.id, who.userId));
    expect(
      await withCurrentAuthority(h.db, "read", signal(), (tx) =>
        currentNativeActor(tx, who, signal()),
      ),
    ).toBeNull();
  }
  const who = await fixture(true);
  await h.db
    .insert(authPolicies)
    .values({ id: true, requireMfaForAll: true })
    .onConflictDoUpdate({
      target: authPolicies.id,
      set: { requireMfaForAll: true },
    });
  try {
    expect(
      await withCurrentAuthority(h.db, "read", signal(), (tx) =>
        currentNativeActor(tx, who, signal()),
      ),
    ).toBeNull();
    await h.db.update(sessions).set({ assurance: "mfa" }).where(eq(sessions.id, who.sessionId));
    expect(
      (
        await withCurrentAuthority(h.db, "read", signal(), (tx) =>
          currentNativeActor(tx, who, signal()),
        )
      )?.actor.id,
    ).toBe(who.userId);
  } finally {
    await h.db.delete(authPolicies);
  }
});

test("selected deactivation uses outer ordering and next reader observes revoked authority", async () => {
  const who = await fixture(false);
  const adminId = randomUUID();
  await h.db
    .insert(users)
    .values({ id: adminId, email: `${adminId}@example.com`, name: "Admin", isAdmin: true });
  const admin = (await hydrateActor(h.db, adminId, signal()))!;
  expect(
    await setUserActive(h.db, admin, { userId: who.userId, isActive: false }, signal()),
  ).toEqual({ ok: true, value: true });
  expect(
    await withCurrentAuthority(h.db, "read", signal(), (tx) =>
      currentNativeActor(tx, who, signal()),
    ),
  ).toBeNull();
});

test("current hydration uses persisted flags instead of caller snapshots", async () => {
  const who = await fixture(false);
  const [set] = await h.db
    .insert(permissionSets)
    .values({ name: randomUUID(), flags: { "deal.create": true } })
    .returning();
  await h.db.update(users).set({ permissionSetId: set!.id }).where(eq(users.id, who.userId));
  const current = await withCurrentAuthority(h.db, "read", signal(), (tx) =>
    currentNativeActor(tx, who, signal()),
  );
  expect(current?.actor.flags.has("deal.create")).toBe(true);
});
