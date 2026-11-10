import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { calendarProviderAccounts } from "@/db/schema/calendarProviderAccounts";
import { makeTestDb } from "@/test/db";
import { finishCalendarAuthorization } from "./accountAuthorization";
import {
  beginTestCalendar,
  calendarTestConfig,
  calendarTestTransport,
  calendarTestSignal as signal,
} from "./accountTestHelpers";
import { getCalendarAccessGrant } from "./accountTokens";
import { whileProviderBlocked } from "./calendarCatalog.gate-helpers";
import { catalogFixture, forbidProviderNetwork } from "./calendarCatalog.test-helpers";

let ctx: Awaited<ReturnType<typeof makeTestDb>>;
let network: ReturnType<typeof forbidProviderNetwork>;
beforeEach(async () => {
  ctx = await makeTestDb();
  network = forbidProviderNetwork();
});
afterEach(async () => {
  try {
    expect(network).not.toHaveBeenCalled();
  } finally {
    network.mockRestore();
    await ctx.close();
  }
});

async function storedGeneration(accountId: string) {
  const [row] = await ctx.db
    .select({
      generation: calendarProviderAccounts.connectionGeneration,
      version: calendarProviderAccounts.version,
    })
    .from(calendarProviderAccounts)
    .where(eq(calendarProviderAccounts.id, accountId));
  if (row === undefined) throw new AppError(ERROR_IDS.DB_INVARIANT, "grant fixture disappeared");
  return row;
}
async function reconnect(userId: string, accountId: string) {
  const start = await beginTestCalendar(ctx.db, userId, accountId);
  expect(
    await finishCalendarAuthorization(
      ctx.db,
      userId,
      calendarTestConfig,
      { ...start, code: "new-generation-consent" },
      signal(),
      { transport: calendarTestTransport({ refreshToken: "new-generation-refresh" }) },
    ),
  ).toEqual({ ok: true, value: { accountId } });
}

it("returns the owned account ID and authoritative generation after committing refresh CAS", async () => {
  const fixture = await catalogFixture(ctx.db);
  const before = await storedGeneration(fixture.accountId);
  const result = await getCalendarAccessGrant(
    ctx.db,
    fixture.userId,
    fixture.accountId,
    calendarTestConfig,
    signal(),
    { transport: calendarTestTransport({ refreshToken: "ordinary-rotation" }) },
  );
  const after = await storedGeneration(fixture.accountId);
  expect(after).toEqual({ generation: before.generation, version: before.version + 1 });
  expect(result).toMatchObject({
    ok: true,
    value: {
      accountId: fixture.accountId,
      connectionGeneration: after.generation,
      accessToken: "access-token",
    },
  });
});

it("a new bind changes the returned lifetime while later ordinary rotations retain it", async () => {
  const fixture = await catalogFixture(ctx.db);
  const original = await storedGeneration(fixture.accountId);
  await reconnect(fixture.userId, fixture.accountId);
  const rebound = await storedGeneration(fixture.accountId);
  expect(rebound.generation).toBe(original.generation + 1);
  for (const refreshToken of ["rotation-one", "rotation-two"]) {
    expect(
      await getCalendarAccessGrant(
        ctx.db,
        fixture.userId,
        fixture.accountId,
        calendarTestConfig,
        signal(),
        { transport: calendarTestTransport({ refreshToken }) },
      ),
    ).toMatchObject({
      ok: true,
      value: {
        accountId: fixture.accountId,
        connectionGeneration: rebound.generation,
      },
    });
  }
  expect((await storedGeneration(fixture.accountId)).generation).toBe(rebound.generation);
});

it("a stale refresh completing after a new bind returns no usable grant or obsolete generation", async () => {
  const fixture = await catalogFixture(ctx.db);
  const result = await whileProviderBlocked(
    (transport, abort) =>
      getCalendarAccessGrant(ctx.db, fixture.userId, fixture.accountId, calendarTestConfig, abort, {
        transport,
      }),
    () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: "obsolete-catalog-access",
            refresh_token: "obsolete-catalog-refresh",
            token_type: "Bearer",
            expires_in: 3600,
          }),
        ),
      ),
    () => reconnect(fixture.userId, fixture.accountId),
    (url) => url.endsWith("/token"),
  );
  expect(result.ok).toBe(false);
  expect(result).not.toHaveProperty("value");
  expect(JSON.stringify(result)).not.toContain("obsolete-catalog-access");
});
