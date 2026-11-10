import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import { emailAccounts } from "@/db/schema";
import {
  calendarOAuthAttempts,
  calendarProviderAccounts,
} from "@/db/schema/calendarProviderAccounts";
import { seedUser } from "@/db/testing/factories";
import { makeTestDb } from "@/test/db";
import { beginCalendarAuthorization, finishCalendarAuthorization } from "./accountAuthorization";
import { disconnectCalendarProviderAccount, listCalendarProviderAccounts } from "./accounts";
import {
  beginTestCalendar,
  calendarTestConfig,
  calendarTestScope,
  calendarTestTransport,
  connectTestCalendar,
  deferredValue,
  calendarTestSignal as signal,
} from "./accountTestHelpers";
import { hashCalendarOAuthToken } from "./authorization";
import { CALENDAR_OAUTH_TTL_MS } from "./authorizationConfig";

let ctx: Awaited<ReturnType<typeof makeTestDb>>;
beforeEach(async () => {
  ctx = await makeTestDb();
});
afterEach(async () => {
  await ctx.close();
});

it("stores only hashed browser-bound state and encrypted PKCE proof with a durable expiry", async () => {
  const owner = await seedUser(ctx.db);
  const now = new Date("2027-03-21T09:00:00Z");
  const started = await beginCalendarAuthorization(ctx.db, owner.id, calendarTestConfig, signal(), {
    now: () => now,
  });
  expect(started.ok).toBe(true);
  if (!started.ok) return;
  const [attempt] = await ctx.db.select().from(calendarOAuthAttempts);
  expect(attempt?.stateHash).toBe(hashCalendarOAuthToken(started.value.state));
  expect(attempt?.browserBindingHash).toBe(hashCalendarOAuthToken(started.value.browserNonce));
  expect(attempt?.expiresAt.getTime()).toBe(now.getTime() + CALENDAR_OAUTH_TTL_MS);
  expect(JSON.stringify(attempt)).not.toContain(started.value.state);
  expect(JSON.stringify(attempt)).not.toContain(started.value.browserNonce);
  expect(attempt?.codeVerifierEnc).toBeInstanceOf(Buffer);
  expect(await ctx.db.select().from(calendarProviderAccounts)).toHaveLength(0);
});
it("binds a separately chosen verified Google subject to the active owner and exposes only safe account metadata", async () => {
  const owner = await seedUser(ctx.db);
  const connected = await connectTestCalendar(ctx.db, owner.id);
  const [account] = await ctx.db.select().from(calendarProviderAccounts);
  expect(account).toMatchObject({
    id: connected.accountId,
    userId: owner.id,
    providerSubject: "external-sub",
    emailAddress: "external@example.invalid",
    clientId: calendarTestConfig.clientId,
    status: "connected",
    scopes: calendarTestScope.split(" "),
  });
  expect(account?.refreshTokenEnc?.includes(Buffer.from("refresh-secret"))).toBe(false);
  const listed = await listCalendarProviderAccounts(ctx.db, owner.id, signal());
  expect(listed.ok).toBe(true);
  expect(JSON.stringify(listed)).not.toContain("refreshToken");
  expect(JSON.stringify(listed)).not.toContain("access-token");
  expect(await ctx.db.select().from(emailAccounts)).toHaveLength(0);
  expect((await ctx.db.select().from(calendarOAuthAttempts))[0]).toMatchObject({
    consumedAt: expect.any(Date),
    codeVerifierEnc: null,
  });
});
it("rejects wrong owner, wrong browser binding and changed app configuration before any HTTP call", async () => {
  const owner = await seedUser(ctx.db);
  const other = await seedUser(ctx.db);
  const start = await beginTestCalendar(ctx.db, owner.id);
  const transport = calendarTestTransport();
  for (const [userId, config, browserNonce] of [
    [other.id, calendarTestConfig, start.browserNonce],
    [owner.id, calendarTestConfig, "b".repeat(43)],
    [owner.id, { ...calendarTestConfig, clientId: "different" }, start.browserNonce],
  ] as const) {
    expect(
      await finishCalendarAuthorization(
        ctx.db,
        userId,
        config,
        { state: start.state, browserNonce, code: "code" },
        signal(),
        { transport },
      ),
    ).toEqual({ ok: false, error: { kind: "invalid_state" } });
  }
  expect(transport).not.toHaveBeenCalled();
  expect(
    (
      await finishCalendarAuthorization(
        ctx.db,
        owner.id,
        calendarTestConfig,
        { ...start, code: "code" },
        signal(),
        { transport },
      )
    ).ok,
  ).toBe(true);
});
it("expires state and permits only one callback to consume it across concurrent requests", async () => {
  const owner = await seedUser(ctx.db);
  const old = await beginTestCalendar(ctx.db, owner.id);
  const transport = calendarTestTransport();
  await ctx.db.update(calendarOAuthAttempts).set({ expiresAt: new Date(Date.now() - 1000) });
  expect(
    (
      await finishCalendarAuthorization(
        ctx.db,
        owner.id,
        calendarTestConfig,
        { ...old, code: "code" },
        signal(),
        { transport },
      )
    ).ok,
  ).toBe(false);
  expect(transport).not.toHaveBeenCalled();
  const start = await beginTestCalendar(ctx.db, owner.id);
  const results = await Promise.all(
    [1, 2].map(() =>
      finishCalendarAuthorization(
        ctx.db,
        owner.id,
        calendarTestConfig,
        { ...start, code: "code" },
        signal(),
        { transport },
      ),
    ),
  );
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  expect(transport).toHaveBeenCalledTimes(2);
  expect(await ctx.db.select().from(calendarProviderAccounts)).toHaveLength(1);
});
it.each([{ verified: false }, { scope: "openid email" }, { refreshToken: null }])(
  "does not store an unusable initial grant: %j",
  async (options) => {
    const owner = await seedUser(ctx.db);
    const start = await beginTestCalendar(ctx.db, owner.id);
    expect(
      (
        await finishCalendarAuthorization(
          ctx.db,
          owner.id,
          calendarTestConfig,
          { ...start, code: "code" },
          signal(),
          { transport: calendarTestTransport(options) },
        )
      ).ok,
    ).toBe(false);
    expect(await ctx.db.select().from(calendarProviderAccounts)).toHaveLength(0);
  },
);
it("pins reconnection to the existing Google subject and preserves a valid refresh token if Google omits a replacement", async () => {
  const owner = await seedUser(ctx.db);
  const account = await connectTestCalendar(ctx.db, owner.id);
  const [before] = await ctx.db.select().from(calendarProviderAccounts);
  const wrong = await beginTestCalendar(ctx.db, owner.id, account.accountId);
  expect(
    await finishCalendarAuthorization(
      ctx.db,
      owner.id,
      calendarTestConfig,
      { ...wrong, code: "code" },
      signal(),
      { transport: calendarTestTransport({ subject: "different-sub" }) },
    ),
  ).toEqual({ ok: false, error: { kind: "identity_mismatch" } });
  const right = await beginTestCalendar(ctx.db, owner.id, account.accountId);
  expect(
    (
      await finishCalendarAuthorization(
        ctx.db,
        owner.id,
        calendarTestConfig,
        { ...right, code: "code" },
        signal(),
        { transport: calendarTestTransport({ refreshToken: null }) },
      )
    ).ok,
  ).toBe(true);
  const [after] = await ctx.db.select().from(calendarProviderAccounts);
  expect(after?.refreshTokenEnc?.equals(before?.refreshTokenEnc ?? Buffer.alloc(0))).toBe(true);
});
it("disconnect cancels a callback already exchanging its code and cannot be undone by its later completion", async () => {
  const owner = await seedUser(ctx.db);
  const account = await connectTestCalendar(ctx.db, owner.id);
  const start = await beginTestCalendar(ctx.db, owner.id, account.accountId);
  const began = deferredValue<void>();
  const release = deferredValue<void>();
  const normal = calendarTestTransport();
  const finishing = finishCalendarAuthorization(
    ctx.db,
    owner.id,
    calendarTestConfig,
    { ...start, code: "code" },
    signal(),
    {
      transport: async (url, init) => {
        if (url.endsWith("/token")) {
          began.resolve();
          await release.promise;
        }
        return normal(url, init);
      },
    },
  );
  await began.promise;
  expect(
    (await disconnectCalendarProviderAccount(ctx.db, owner.id, account.accountId, signal())).ok,
  ).toBe(true);
  release.resolve();
  expect((await finishing).ok).toBe(false);
  const [stored] = await ctx.db
    .select()
    .from(calendarProviderAccounts)
    .where(eq(calendarProviderAccounts.id, account.accountId));
  expect(stored).toMatchObject({ status: "disconnected", refreshTokenEnc: null });
});
