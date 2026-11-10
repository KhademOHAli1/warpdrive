import { afterEach, beforeEach, expect, it } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { makeTestDb, type TestDb } from "@/test/db";
import { bindCalendarGrant } from "./accountBind";
import { legacyCalendarSchema } from "./accountConnectionMigration.schema-helpers";
import {
  type LegacyCalendarState,
  legacyAccountEvidence,
  resumedLegacyContext,
  seedLegacyCalendarState,
  upgradedLegacyAttempts,
} from "./accountConnectionMigration.test-helpers";
import {
  calendarTestConfig,
  calendarTestScope,
  calendarTestSignal as signal,
} from "./accountTestHelpers";

let ctx: TestDb | undefined;
let schema: Awaited<ReturnType<typeof legacyCalendarSchema>> | undefined;
let state: LegacyCalendarState | undefined;
let accountsBefore: Awaited<ReturnType<typeof legacyAccountEvidence>>;

function fixture() {
  if (ctx === undefined || schema === undefined || state === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "legacy migration fixture missing");
  return { ctx, schema, state };
}
beforeEach(async () => {
  ctx = await makeTestDb();
  schema = await legacyCalendarSchema(ctx, signal());
  state = await seedLegacyCalendarState(ctx, signal());
  accountsBefore = await legacyAccountEvidence(ctx, signal());
});
afterEach(async () => {
  try {
    schema?.cleanup();
  } finally {
    await ctx?.close();
    ctx = undefined;
    schema = undefined;
    state = undefined;
  }
});

it("initializes independent generation one without changing legacy credential versions or account fields", async () => {
  const f = fixture();
  await f.schema.upgrade(signal());
  expect(await legacyAccountEvidence(f.ctx, signal())).toEqual(accountsBefore);
  const rows = await f.ctx.pool.query<{ id: string; version: number; generation: number }>(
    "SELECT id,version,connection_generation AS generation FROM calendar_provider_accounts ORDER BY version",
  );
  expect(rows.rows).toEqual([
    { id: f.state.accountId, version: 37, generation: 1 },
    { id: f.state.otherAccountId, version: 73, generation: 1 },
  ]);
  for (const attempt of await upgradedLegacyAttempts(f.ctx, signal())) {
    expect(attempt.pin).toBeNull();
    expect(attempt.snapshot).toBeNull();
  }
});

it("retires targeted and untargeted pending and consumed attempts and clears leftover verifier ciphertext", async () => {
  const f = fixture();
  await f.schema.upgrade(signal());
  expect(await legacyAccountEvidence(f.ctx, signal())).toEqual(accountsBefore);
  const attempts = await upgradedLegacyAttempts(f.ctx, signal());
  expect(attempts).toHaveLength(f.state.attempts.length);
  for (const attempt of attempts) {
    expect.soft(attempt.cancelledAt).toBeInstanceOf(Date);
    expect.soft(attempt.verifier).toBeNull();
    expect.soft(attempt.pin).toBeNull();
    expect.soft(attempt.snapshot).toBeNull();
  }
  const alreadyCancelled = f.state.attempts.find((attempt) => attempt.cancelledAt !== null);
  expect(
    attempts.find((attempt) => attempt.stateHash === alreadyCancelled?.stateHash)?.cancelledAt,
  ).toEqual(f.state.oldCancellation);
});

it.each([true, false])(
  "a consumed legacy callback cannot bind after retirement (targeted=%s)",
  async (targeted) => {
    const f = fixture();
    await f.schema.upgrade(signal());
    const context = resumedLegacyContext(f.state, targeted);
    const retired = (await upgradedLegacyAttempts(f.ctx, signal())).find(
      (attempt) => attempt.stateHash === context.stateHash,
    );
    expect(retired?.cancelledAt).toBeInstanceOf(Date);
    expect(retired?.verifier).toBeNull();
    const beforeBind = await legacyAccountEvidence(f.ctx, signal());
    expect(
      await bindCalendarGrant(
        f.ctx.db,
        context,
        calendarTestConfig,
        {
          subject: "legacy-subject",
          emailAddress: "stale-callback@example.invalid",
          hostedDomain: null,
        },
        {
          accessToken: "synthetic-stale-access",
          expiresIn: 3600,
          refreshToken: "synthetic-stale-replacement",
          grantedScopes: calendarTestScope.split(" "),
        },
        {},
        signal(),
        () => new Date(),
      ),
    ).toEqual({ ok: false, error: { kind: "invalid_state" } });
    expect(await legacyAccountEvidence(f.ctx, signal())).toEqual(beforeBind);
  },
);
