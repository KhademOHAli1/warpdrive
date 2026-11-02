import { expect } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { seedUser } from "@/db/testing/factories";
import type { TestDb } from "@/test/db";
import { type CalendarOAuthStart, finishCalendarAuthorization } from "./accountAuthorization";
import { listCalendarProviderAccounts } from "./accounts";
import {
  beginTestCalendar,
  calendarTestConfig,
  calendarTestTransport,
  connectTestCalendar,
  deferredValue,
  calendarTestSignal as signal,
} from "./accountTestHelpers";
import { getCalendarAccessGrant } from "./accountTokens";
import { hashCalendarOAuthToken } from "./authorization";
import type { GoogleTransport } from "./contracts";

export const snapshotCorruptions = [
  "null snapshot",
  "array snapshot",
  "invalid account ID",
  "fractional generation",
  "snapshot disagrees with pin",
  "missing targeted pin",
  "targeted pin disagrees with account",
] as const;

export function corruptedSnapshot(
  bad: (typeof snapshotCorruptions)[number],
  accountId: string,
  generation: number,
): { snapshot: unknown; pin: number | null } {
  switch (bad) {
    case "null snapshot":
      return { snapshot: null, pin: generation };
    case "array snapshot":
      return { snapshot: [], pin: generation };
    case "invalid account ID":
      return { snapshot: { "not-an-account-id": generation }, pin: generation };
    case "fractional generation":
      return { snapshot: { [accountId]: generation + 0.5 }, pin: generation };
    case "snapshot disagrees with pin":
      return { snapshot: { [accountId]: generation + 1 }, pin: generation };
    case "missing targeted pin":
      return { snapshot: { [accountId]: generation }, pin: null };
    case "targeted pin disagrees with account":
      return { snapshot: { [accountId]: generation + 1 }, pin: generation + 1 };
  }
}

export async function snapshotFixture(ctx: TestDb, targeted = false) {
  const owner = await seedUser(ctx.db);
  const connected = await connectTestCalendar(ctx.db, owner.id);
  const start = await beginTestCalendar(
    ctx.db,
    owner.id,
    targeted ? connected.accountId : undefined,
  );
  const metadata = await ctx.pool.query<{ generation: number }>(
    "SELECT connection_generation AS generation FROM calendar_provider_accounts WHERE id = $1",
    [connected.accountId],
  );
  const generation = metadata.rows[0]?.generation;
  if (generation === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "snapshot fixture account is missing");
  return {
    userId: owner.id,
    accountId: connected.accountId,
    generation,
    start,
    before: await listCalendarProviderAccounts(ctx.db, owner.id, signal()),
  };
}

export async function finishSnapshot(
  ctx: TestDb,
  userId: string,
  start: CalendarOAuthStart,
  transport: GoogleTransport,
) {
  return finishCalendarAuthorization(
    ctx.db,
    userId,
    calendarTestConfig,
    { ...start, code: "snapshot-qualification-code" },
    signal(),
    { transport },
  );
}

export async function blockedSnapshotExchange(
  ctx: TestDb,
  userId: string,
  start: CalendarOAuthStart,
  refreshToken: string | null = null,
) {
  const began = deferredValue<void>();
  const release = deferredValue<void>();
  const response: GoogleTransport = calendarTestTransport({
    email: "snapshot-consent@example.invalid",
    refreshToken,
  });
  const finishing = finishSnapshot(ctx, userId, start, async (url, init) => {
    if (url.endsWith("/token")) {
      began.resolve();
      await release.promise;
    }
    return response(url, init);
  });
  await Promise.race([
    began.promise,
    finishing.then(() => {
      throw new AppError(ERROR_IDS.DB_INVARIANT, "callback ended before snapshot exchange gate");
    }),
  ]);
  return { finishing, release };
}

export async function rewriteSnapshot(
  ctx: TestDb,
  state: string,
  snapshot: unknown,
  pin: number | null,
) {
  const changed = await ctx.pool.query(
    `UPDATE calendar_oauth_attempts
     SET account_connection_generations = $1::jsonb, account_connection_generation = $2
     WHERE state_hash = $3`,
    [snapshot === null ? null : JSON.stringify(snapshot), pin, hashCalendarOAuthToken(state)],
  );
  expect(changed.rowCount).toBe(1);
}

export async function expectSnapshotRefresh(
  ctx: TestDb,
  userId: string,
  accountId: string,
  expected: string,
) {
  const used: string[] = [];
  const response: GoogleTransport = calendarTestTransport({ refreshToken: null });
  const transport: GoogleTransport = (url, init) => {
    if (typeof init.body === "string")
      used.push(new URLSearchParams(init.body).get("refresh_token") ?? "");
    return response(url, init);
  };
  expect(
    (
      await getCalendarAccessGrant(ctx.db, userId, accountId, calendarTestConfig, signal(), {
        transport,
      })
    ).ok,
  ).toBe(true);
  expect(used).toEqual([expected]);
}
