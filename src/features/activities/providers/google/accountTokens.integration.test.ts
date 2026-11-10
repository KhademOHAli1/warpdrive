import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { users } from "@/db/schema";
import {
  calendarOAuthAttempts,
  calendarProviderAccounts,
} from "@/db/schema/calendarProviderAccounts";
import { seedUser } from "@/db/testing/factories";
import { makeTestDb } from "@/test/db";
import {
  disconnectCalendarProviderAccount,
  listCalendarProviderAccounts,
  revokeCalendarProviderAccountsForUser,
} from "./accounts";
import {
  beginTestCalendar,
  calendarTestConfig,
  connectTestCalendar,
  deferredValue,
  calendarTestSignal as signal,
} from "./accountTestHelpers";
import { getCalendarAccessGrant } from "./accountTokens";
import { decryptCalendarSecret } from "./tokenCrypto";

let ctx: Awaited<ReturnType<typeof makeTestDb>>;
beforeEach(async () => {
  ctx = await makeTestDb();
});
afterEach(async () => {
  await ctx.close();
});
const refreshed = (refreshToken?: string) =>
  new Response(
    JSON.stringify({
      access_token: "new-access",
      token_type: "Bearer",
      expires_in: 3600,
      ...(refreshToken !== undefined ? { refresh_token: refreshToken } : {}),
    }),
  );

it("never returns or refreshes another owner's account, and an inactive owner cannot reuse cached authority", async () => {
  const owner = await seedUser(ctx.db);
  const stranger = await seedUser(ctx.db);
  const account = await connectTestCalendar(ctx.db, owner.id);
  const transport = vi.fn().mockResolvedValue(refreshed());
  expect(
    await getCalendarAccessGrant(
      ctx.db,
      stranger.id,
      account.accountId,
      calendarTestConfig,
      signal(),
      { transport },
    ),
  ).toEqual({ ok: false, error: { kind: "not_found" } });
  expect(
    await disconnectCalendarProviderAccount(ctx.db, stranger.id, account.accountId, signal()),
  ).toEqual({ ok: false, error: { kind: "not_found" } });
  await ctx.db.update(users).set({ isActive: false }).where(eq(users.id, owner.id));
  expect(
    (
      await getCalendarAccessGrant(
        ctx.db,
        owner.id,
        account.accountId,
        calendarTestConfig,
        signal(),
        { transport },
      )
    ).ok,
  ).toBe(false);
  expect((await listCalendarProviderAccounts(ctx.db, owner.id, signal())).ok).toBe(false);
  expect(transport).not.toHaveBeenCalled();
});
it("malformed owner/account identifiers fail closed without database UUID errors or HTTP", async () => {
  const owner = await seedUser(ctx.db);
  const account = await connectTestCalendar(ctx.db, owner.id);
  const transport = vi.fn().mockResolvedValue(refreshed());
  for (const [userId, accountId] of [
    ["not-a-uuid", account.accountId],
    [owner.id, "bad-id"],
  ]) {
    expect(
      await getCalendarAccessGrant(
        ctx.db,
        userId ?? "",
        accountId ?? "",
        calendarTestConfig,
        signal(),
        { transport },
      ),
    ).toEqual({ ok: false, error: { kind: "not_found" } });
  }
  expect(transport).not.toHaveBeenCalled();
});
it("persists refresh-token rotation encrypted and returns a short-lived server grant", async () => {
  const owner = await seedUser(ctx.db);
  const account = await connectTestCalendar(ctx.db, owner.id);
  const result = await getCalendarAccessGrant(
    ctx.db,
    owner.id,
    account.accountId,
    calendarTestConfig,
    signal(),
    {
      transport: vi.fn().mockResolvedValue(refreshed("rotated-secret")),
      now: () => new Date("2027-03-21T09:00:00Z"),
    },
  );
  expect(result).toMatchObject({
    ok: true,
    value: { accessToken: "new-access", expiresAt: Date.parse("2027-03-21T10:00:00Z") },
  });
  const [stored] = await ctx.db.select().from(calendarProviderAccounts);
  expect(stored?.refreshTokenEnc?.includes(Buffer.from("rotated-secret"))).toBe(false);
  expect(
    stored?.refreshTokenEnc !== null &&
      stored?.refreshTokenEnc !== undefined &&
      decryptCalendarSecret(stored.refreshTokenEnc),
  ).toEqual({ ok: true, value: "rotated-secret" });
});
it("rejects a changed client app without disconnecting a still-valid grant", async () => {
  const owner = await seedUser(ctx.db);
  const account = await connectTestCalendar(ctx.db, owner.id);
  const transport = vi.fn().mockResolvedValue(refreshed());
  expect(
    await getCalendarAccessGrant(
      ctx.db,
      owner.id,
      account.accountId,
      { ...calendarTestConfig, clientId: "other-client" },
      signal(),
      { transport },
    ),
  ).toEqual({ ok: false, error: { kind: "configuration" } });
  expect(transport).not.toHaveBeenCalled();
  expect((await ctx.db.select().from(calendarProviderAccounts))[0]?.status).toBe("connected");
});
it("genuine invalid_grant requires reauthorization, but tampering/transient errors preserve the connection", async () => {
  const owner = await seedUser(ctx.db);
  const account = await connectTestCalendar(ctx.db, owner.id);
  const transient = await getCalendarAccessGrant(
    ctx.db,
    owner.id,
    account.accountId,
    calendarTestConfig,
    signal(),
    { transport: vi.fn().mockResolvedValue(new Response("failure", { status: 503 })) },
  );
  expect(transient.ok).toBe(false);
  expect((await ctx.db.select().from(calendarProviderAccounts))[0]?.status).toBe("connected");
  const revoked = await getCalendarAccessGrant(
    ctx.db,
    owner.id,
    account.accountId,
    calendarTestConfig,
    signal(),
    {
      transport: vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
        ),
    },
  );
  expect(revoked.ok).toBe(false);
  expect((await ctx.db.select().from(calendarProviderAccounts))[0]).toMatchObject({
    status: "reauthRequired",
    refreshTokenEnc: null,
    lastErrorCode: "unauthorized",
  });
  const second = await connectTestCalendar(ctx.db, owner.id, { subject: "second-sub" });
  await ctx.db
    .update(calendarProviderAccounts)
    .set({ refreshTokenEnc: Buffer.from("broken") })
    .where(eq(calendarProviderAccounts.id, second.accountId));
  expect(
    await getCalendarAccessGrant(ctx.db, owner.id, second.accountId, calendarTestConfig, signal()),
  ).toEqual({ ok: false, error: { kind: "credential_corrupt" } });
  expect(
    (
      await ctx.db
        .select()
        .from(calendarProviderAccounts)
        .where(eq(calendarProviderAccounts.id, second.accountId))
    )[0]?.status,
  ).toBe("connected");
});
it("a refresh racing disconnect cannot return access or resurrect the cleared credential", async () => {
  const owner = await seedUser(ctx.db);
  const account = await connectTestCalendar(ctx.db, owner.id);
  const began = deferredValue<void>();
  const release = deferredValue<void>();
  const running = getCalendarAccessGrant(
    ctx.db,
    owner.id,
    account.accountId,
    calendarTestConfig,
    signal(),
    {
      transport: async () => {
        began.resolve();
        await release.promise;
        return refreshed("rotated");
      },
    },
  );
  await began.promise;
  await disconnectCalendarProviderAccount(ctx.db, owner.id, account.accountId, signal());
  release.resolve();
  expect((await running).ok).toBe(false);
  expect((await ctx.db.select().from(calendarProviderAccounts))[0]).toMatchObject({
    status: "disconnected",
    refreshTokenEnc: null,
  });
});
it("two concurrent rotations cannot overwrite each other or return a stale successful grant", async () => {
  const owner = await seedUser(ctx.db);
  const account = await connectTestCalendar(ctx.db, owner.id);
  const both = deferredValue<void>();
  let arrivals = 0;
  const transport = async () => {
    arrivals += 1;
    if (arrivals === 2) both.resolve();
    await both.promise;
    return refreshed(`rotation-${arrivals}`);
  };
  const results = await Promise.all(
    [1, 2].map(() =>
      getCalendarAccessGrant(ctx.db, owner.id, account.accountId, calendarTestConfig, signal(), {
        transport,
      }),
    ),
  );
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  expect(results.filter((r) => !r.ok)).toHaveLength(1);
});
it("trusted offboarding clears every Calendar credential and in-flight authorization without reactivation revival", async () => {
  const owner = await seedUser(ctx.db);
  await connectTestCalendar(ctx.db, owner.id);
  await connectTestCalendar(ctx.db, owner.id, { subject: "another-sub" });
  await beginTestCalendar(ctx.db, owner.id);
  await ctx.db.transaction(async (tx) => {
    await tx.update(users).set({ isActive: false }).where(eq(users.id, owner.id));
    await revokeCalendarProviderAccountsForUser(tx, owner.id, signal());
  });
  expect(
    (await ctx.db.select().from(calendarProviderAccounts)).every(
      (a) => a.status === "disconnected" && a.refreshTokenEnc === null,
    ),
  ).toBe(true);
  expect(
    (await ctx.db.select().from(calendarOAuthAttempts)).every(
      (a) => a.cancelledAt !== null && a.codeVerifierEnc === null,
    ),
  ).toBe(true);
  await ctx.db.update(users).set({ isActive: true }).where(eq(users.id, owner.id));
  const listed = await listCalendarProviderAccounts(ctx.db, owner.id, signal());
  expect(listed.ok && listed.value.every((a) => a.status === "disconnected")).toBe(true);
});
