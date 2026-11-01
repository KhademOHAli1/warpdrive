import { eq, like } from "drizzle-orm";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  deals,
  emailAccounts,
  integrationConnections,
  oauthAccessTokens,
  oauthAuthCodes,
  oauthRefreshTokens,
  permissionSets,
  userPreferences,
  users,
} from "@/db/schema";
import { toVisibleDeal } from "@/features/deals/dealAuth";
import { assertMailboxOwner } from "@/features/email/mailboxOwnership";
import { withSlackConnection } from "@/features/integrations/service";
import { exchangeMcpGrant } from "@/features/oauth/exchange";
import { can } from "@/features/permissions/can";
import { canSee } from "@/features/permissions/canSee";
import { hydrateActor } from "@/server/hydrateActor";
import { makeTestDb, type TestDb } from "@/test/db";
import { createIntegrationPlatformFixtures } from "./integrationPlatformFixtures";

const now = new Date("2026-10-31T12:00:00.000Z");
const signal = () => AbortSignal.timeout(10_000);
let h: TestDb;
beforeEach(async () => {
  h = await makeTestDb();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
});
afterEach(async () => {
  vi.useRealTimers();
  await h.close();
});

test("reusable synthetic actors and records enforce visible, hidden and restricted-pipeline cases", async () => {
  const result = await createIntegrationPlatformFixtures(h, { namespace: "roles", now }, signal());
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const f = result.value;
  const admin = await hydrateActor(h.db, f.users.admin.id, signal());
  const member = await hydrateActor(h.db, f.users.member.id, signal());
  expect(admin?.type).toBe("admin");
  expect(member?.type).toBe("regular");
  expect(await hydrateActor(h.db, f.users.inactive.id, signal())).toBeNull();
  if (admin === null || member === null) return;
  expect(canSee(member, toVisibleDeal(f.deals.visible, null))).toBe(true);
  expect(can(member, "deal.edit", toVisibleDeal(f.deals.visible, null))).toBe(true);
  expect(canSee(member, toVisibleDeal(f.deals.hidden, null))).toBe(false);
  expect(canSee(member, toVisibleDeal(f.deals.restricted, f.restrictedGroupId))).toBe(false);
  expect(canSee(admin, toVisibleDeal(f.deals.hidden, null))).toBe(true);
  expect(canSee(admin, toVisibleDeal(f.deals.restricted, f.restrictedGroupId))).toBe(true);
  expect(f.users.member.email).toMatch(/@example\.test$/);
  expect(f.limits.oauthCapabilities).toBe("not-persisted-in-current-model");
});

test("actual current OAuth rows encode valid, expired, revoked and inactive-owner grants", async () => {
  const result = await createIntegrationPlatformFixtures(h, { namespace: "grants", now }, signal());
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const f = result.value;
  for (const kind of ["expired", "revoked", "inactiveOwner"] as const) {
    const grant = f.grants[kind];
    expect(
      await exchangeMcpGrant(
        h.db,
        {
          grant_type: "refresh_token",
          client_id: grant.clientId,
          refresh_token: grant.refreshToken,
        },
        signal(),
      ),
    ).toEqual({ ok: false, error: "invalid_grant" });
  }
  const [valid] = await h.db
    .select()
    .from(oauthAccessTokens)
    .where(eq(oauthAccessTokens.jti, f.grants.valid.accessJti));
  expect(valid?.expiresAt.getTime()).toBe(now.getTime() + 3_600_000);
  expect(valid?.revokedAt).toBeNull();
  const [expired] = await h.db
    .select()
    .from(oauthRefreshTokens)
    .where(eq(oauthRefreshTokens.tokenHash, f.grants.expired.refreshTokenHash));
  expect(expired?.expiresAt.getTime()).toBe(now.getTime() - 1);
  const [revokedCode] = await h.db
    .select()
    .from(oauthAuthCodes)
    .where(eq(oauthAuthCodes.codeHash, f.grants.revoked.codeHash));
  expect(revokedCode?.consumedAt?.getTime()).toBe(now.getTime() - 60_000);
  const columns = (
    await h.pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name='oauth_access_tokens'",
    )
  ).rows as { column_name: string }[];
  expect(columns.map((row) => row.column_name)).not.toContain("scopes");
});

test("the valid refresh fixture exchanges and rotates through the actual OAuth path", async () => {
  // Only Date is frozen by this suite; real PostgreSQL/network timers keep running.
  const seeded = await createIntegrationPlatformFixtures(
    h,
    { namespace: "positive", now },
    signal(),
  );
  expect(seeded.ok).toBe(true);
  if (!seeded.ok) return;
  const grant = seeded.value.grants.valid;
  const input = {
    grant_type: "refresh_token" as const,
    client_id: grant.clientId,
    refresh_token: grant.refreshToken,
  };
  const first = await exchangeMcpGrant(h.db, input, signal());
  expect(first.ok).toBe(true);
  if (!first.ok) return;
  expect(first.value.token_type).toBe("Bearer");
  expect(first.value.refresh_token).not.toBe(grant.refreshToken);
  expect(await exchangeMcpGrant(h.db, input, signal())).toEqual({
    ok: false,
    error: "invalid_grant",
  });
  const second = await exchangeMcpGrant(
    h.db,
    { ...input, refresh_token: first.value.refresh_token },
    signal(),
  );
  expect(second.ok).toBe(true);
});

test("multiple service workspaces and personal accounts retain current shared-admin and owner policies", async () => {
  const result = await createIntegrationPlatformFixtures(
    h,
    { namespace: "accounts", now },
    signal(),
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const f = result.value;
  const connections = await h.db.select().from(integrationConnections);
  expect(connections).toHaveLength(2);
  expect(new Set(connections.map((row) => row.accountId)).size).toBe(2);
  expect(connections.every((row) => row.ownerId === f.users.admin.id)).toBe(true);
  expect(
    connections.every(
      (row) => row.credentials !== null && !row.credentials.toString("utf8").includes("synthetic"),
    ),
  ).toBe(true);
  const use = () => Promise.resolve("local-only");
  expect(await withSlackConnection(h.db, f.users.admin.id, f.connections.first.id, use)).toBe(
    "local-only",
  );
  await expect(
    withSlackConnection(h.db, f.users.member.id, f.connections.first.id, use),
  ).rejects.toThrow("integration_forbidden");
  expect(
    (await assertMailboxOwner(h.db, f.mailboxes.member.id, f.users.member.id, signal())).ok,
  ).toBe(true);
  expect(
    (await assertMailboxOwner(h.db, f.mailboxes.member.id, f.users.outsider.id, signal())).ok,
  ).toBe(false);
  expect(await h.db.select().from(emailAccounts)).toHaveLength(2);
  await expect(
    h.db
      .insert(emailAccounts)
      .values({ userId: f.users.member.id, emailAddress: "second-personal@example.test" }),
  ).rejects.toMatchObject({ cause: { code: "23505" } });
  expect(f.limits.personalMailboxesPerUser).toBe(1);
});

test("FA/DE/EN preferences preserve calendar, numbering and zone independently in PostgreSQL", async () => {
  const result = await createIntegrationPlatformFixtures(
    h,
    { namespace: "preferences", now },
    signal(),
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const f = result.value;
  for (const key of ["admin", "member", "outsider"] as const) {
    const [row] = await h.db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, f.users[key].id));
    expect(row?.ui).toEqual({ localePreferences: f.preferences[key] });
    expect(row?.timezone).toBe(f.preferences[key].timeZone);
  }
  expect(f.preferences.admin).toEqual({
    locale: "fa",
    calendar: "gregory",
    numberingSystem: "latn",
    timeZone: "Europe/Berlin",
  });
  expect(f.preferences.member).toEqual({
    locale: "de",
    calendar: "persian",
    numberingSystem: "arabext",
    timeZone: "Asia/Tehran",
  });
  expect(f.preferences.outsider.locale).toBe("en");
});

test("invalid clock, non-disposable targets and pre-abort fail before any fixture writes", async () => {
  expect(
    await createIntegrationPlatformFixtures(
      h,
      { namespace: "bad", now: new Date("invalid") },
      signal(),
    ),
  ).toEqual({ ok: false, error: { code: "invalid_input" } });
  expect(
    await createIntegrationPlatformFixtures(
      { ...h, url: "postgres://unused@localhost/production" },
      { namespace: "guard", now },
      signal(),
    ),
  ).toEqual({ ok: false, error: { code: "disposable_database_required" } });
  const override = new URL(h.url);
  override.searchParams.set("statement_timeout", "0");
  expect(
    await createIntegrationPlatformFixtures(
      { ...h, url: override.toString() },
      { namespace: "overrides", now },
      signal(),
    ),
  ).toEqual({ ok: false, error: { code: "disposable_database_required" } });
  const controller = new AbortController();
  const reason = new DOMException("Fixture cancelled", "AbortError");
  controller.abort(reason);
  await expect(
    createIntegrationPlatformFixtures(h, { namespace: "abort", now }, controller.signal),
  ).rejects.toBe(reason);
  expect(await h.db.select().from(users)).toHaveLength(0);
});

test("a duplicate fixture namespace returns a safe error and rolls back without partial rows", async () => {
  expect(
    (await createIntegrationPlatformFixtures(h, { namespace: "duplicate", now }, signal())).ok,
  ).toBe(true);
  expect(
    await createIntegrationPlatformFixtures(h, { namespace: "duplicate", now }, signal()),
  ).toEqual({ ok: false, error: { code: "write_failed" } });
  expect(await h.db.select().from(users)).toHaveLength(4);
  expect(await h.db.select().from(deals)).toHaveLength(3);
  expect(
    await h.db
      .select()
      .from(permissionSets)
      .where(like(permissionSets.name, "fixture:duplicate:%")),
  ).toHaveLength(1);
});
