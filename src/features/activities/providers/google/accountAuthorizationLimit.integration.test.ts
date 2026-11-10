import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { calendarOAuthAttempts } from "@/db/schema/calendarProviderAccounts";
import { seedUser } from "@/db/testing/factories";
import { makeTestDb } from "@/test/db";
import { beginCalendarAuthorization } from "./accountAuthorization";
import { cancelCalendarAuthorization } from "./accountAuthorizationCancel";
import { consumeCalendarAuthorization } from "./accountAuthorizationState";
import { calendarTestConfig, calendarTestSignal as signal } from "./accountTestHelpers";
import {
  calendarRouteUser,
  routeBaseUrl,
  routeConfig,
  startRequest,
  startRoute,
} from "./authorizationRoutes.test-helpers";
import { handleCalendarAuthorizationStart } from "./authorizationStartHttp";

// This is the product admission contract, independent of a production constant.
const EXPECTED_OWNER_CAP = 8;
let ctx: Awaited<ReturnType<typeof makeTestDb>>;
beforeEach(async () => {
  ctx = await makeTestDb();
});
afterEach(async () => {
  await ctx.close();
});

function start(userId: string, now: Date) {
  return beginCalendarAuthorization(ctx.db, userId, calendarTestConfig, signal(), {
    now: () => now,
  });
}
function stored(userId: string) {
  return ctx.db
    .select({ stateHash: calendarOAuthAttempts.stateHash })
    .from(calendarOAuthAttempts)
    .where(eq(calendarOAuthAttempts.userId, userId))
    .orderBy(calendarOAuthAttempts.stateHash);
}
async function fill(userId: string, now: Date) {
  const results = await Promise.all(
    Array.from({ length: EXPECTED_OWNER_CAP }, () => start(userId, now)),
  );
  return results.map((result) => {
    expect(result.ok).toBe(true);
    if (!result.ok)
      throw new AppError(ERROR_IDS.DB_INVARIANT, "authorization limit fixture failed");
    return result.value;
  });
}

it("serializes nine concurrent starts to exactly eight durable attempts for one owner", async () => {
  const owner = await seedUser(ctx.db);
  const now = new Date();
  const results = await Promise.all(
    Array.from({ length: EXPECTED_OWNER_CAP + 1 }, () => start(owner.id, now)),
  );
  expect(results.filter((result) => result.ok)).toHaveLength(EXPECTED_OWNER_CAP);
  expect(results.filter((result) => !result.ok)).toEqual([
    { ok: false, error: { kind: "rate_limited" } },
  ]);
  const rows = await stored(owner.id);
  expect(rows).toHaveLength(EXPECTED_OWNER_CAP);
  expect(new Set(rows.map((row) => row.stateHash)).size).toBe(EXPECTED_OWNER_CAP);
});

it.each(["consumed", "cancelled"] as const)(
  "still counts unexpired %s attempts because their responses may still be in transit",
  async (state) => {
    const owner = await seedUser(ctx.db);
    const now = new Date();
    const attempts = await fill(owner.id, now);
    for (const attempt of attempts) {
      const input = { state: attempt.state, browserNonce: attempt.browserNonce };
      const changed =
        state === "consumed"
          ? await consumeCalendarAuthorization(
              ctx.db,
              owner.id,
              calendarTestConfig,
              input,
              signal(),
              () => now,
            )
          : await cancelCalendarAuthorization(
              ctx.db,
              owner.id,
              calendarTestConfig,
              input,
              signal(),
            );
      expect(changed.ok).toBe(true);
    }
    const before = await stored(owner.id);
    expect(await start(owner.id, now)).toEqual({ ok: false, error: { kind: "rate_limited" } });
    expect(await stored(owner.id)).toEqual(before);
  },
);

it("admits a new start exactly at expiry while the last unexpired millisecond remains capped", async () => {
  const owner = await seedUser(ctx.db);
  const now = new Date();
  const attempts = await fill(owner.id, now);
  const first = attempts[0];
  if (first === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "authorization expiry fixture missing");
  const expiry = new Date(first.expiresAt);
  const before = await stored(owner.id);
  expect(await start(owner.id, new Date(expiry.getTime() - 1))).toEqual({
    ok: false,
    error: { kind: "rate_limited" },
  });
  expect(await stored(owner.id)).toEqual(before);
  const admitted = await start(owner.id, expiry);
  expect(admitted.ok).toBe(true);
  if (admitted.ok)
    expect(new Date(admitted.value.expiresAt).getTime()).toBeGreaterThan(expiry.getTime());
});

it("does not spend another owner's allowance when one owner is capped", async () => {
  const owner = await seedUser(ctx.db);
  const other = await seedUser(ctx.db);
  const now = new Date();
  await fill(owner.id, now);
  expect(await start(owner.id, now)).toEqual({ ok: false, error: { kind: "rate_limited" } });
  expect((await start(other.id, now)).ok).toBe(true);
  expect(await stored(owner.id)).toHaveLength(EXPECTED_OWNER_CAP);
  expect(await stored(other.id)).toHaveLength(1);
});

it("returns HTTP 429 without a new browser cookie or attempt when the owner reaches the cap", async () => {
  const owner = await calendarRouteUser(ctx.db);
  const responses = await Promise.all(
    Array.from({ length: EXPECTED_OWNER_CAP }, () => startRoute(ctx.db, owner)),
  );
  expect(responses.every((result) => result.response.headers.getSetCookie().length > 0)).toBe(true);
  const before = await stored(owner.user.id);
  expect(before).toHaveLength(EXPECTED_OWNER_CAP);
  const response = await handleCalendarAuthorizationStart(ctx.db, startRequest(owner), signal(), {
    config: routeConfig,
    baseUrl: routeBaseUrl,
  });
  expect(response.status).toBe(429);
  expect(await response.json()).toEqual({ ok: false, error: "rate_limited" });
  expect(response.headers.getSetCookie()).toEqual([]);
  expect(await stored(owner.user.id)).toEqual(before);
});
