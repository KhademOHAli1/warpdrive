import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import { calendarOAuthAttempts } from "@/db/schema/calendarProviderAccounts";
import { makeTestDb } from "@/test/db";
import {
  blockedSnapshotExchange,
  corruptedSnapshot,
  expectSnapshotRefresh,
  finishSnapshot,
  rewriteSnapshot,
  snapshotCorruptions,
  snapshotFixture,
} from "./accountConnectionSnapshot.test-helpers";
import { listCalendarProviderAccounts } from "./accounts";
import {
  calendarTestConfig,
  calendarTestTransport,
  calendarTestSignal as signal,
} from "./accountTestHelpers";
import { getCalendarAccessGrant } from "./accountTokens";
import { hashCalendarOAuthToken } from "./authorization";
import type { GoogleTransport } from "./contracts";

let ctx: Awaited<ReturnType<typeof makeTestDb>>;
beforeEach(async () => {
  ctx = await makeTestDb();
});
afterEach(async () => {
  await ctx.close();
});

it.each(["before consumption", "during exchange"] as const)(
  "an untargeted existing-account Connect survives ordinary refresh %s and keeps its latest credential when consent omits one",
  async (timing) => {
    const fixture = await snapshotFixture(ctx);
    const pending =
      timing === "during exchange"
        ? await blockedSnapshotExchange(ctx, fixture.userId, fixture.start)
        : null;
    try {
      expect(
        (
          await getCalendarAccessGrant(
            ctx.db,
            fixture.userId,
            fixture.accountId,
            calendarTestConfig,
            signal(),
            { transport: calendarTestTransport({ refreshToken: "snapshot-rotated-refresh" }) },
          )
        ).ok,
      ).toBe(true);
    } finally {
      if (pending !== null) {
        pending.release.resolve();
        await pending.finishing;
      }
    }
    const finished =
      pending === null
        ? await finishSnapshot(
            ctx,
            fixture.userId,
            fixture.start,
            calendarTestTransport({
              email: "snapshot-consent@example.invalid",
              refreshToken: null,
            }),
          )
        : await pending.finishing;
    expect(finished).toEqual({ ok: true, value: { accountId: fixture.accountId } });
    expect(await listCalendarProviderAccounts(ctx.db, fixture.userId, signal())).toMatchObject({
      ok: true,
      value: [
        {
          id: fixture.accountId,
          status: "connected",
          emailAddress: "snapshot-consent@example.invalid",
        },
      ],
    });
    await expectSnapshotRefresh(ctx, fixture.userId, fixture.accountId, "snapshot-rotated-refresh");
  },
);

it.each(snapshotCorruptions)(
  "%s is denied before provider HTTP without consuming or replacing the grant",
  async (bad) => {
    const fixture = await snapshotFixture(ctx, true);
    const { snapshot, pin } = corruptedSnapshot(bad, fixture.accountId, fixture.generation);
    await rewriteSnapshot(ctx, fixture.start.state, snapshot, pin);
    const transport = calendarTestTransport({ refreshToken: "must-not-be-bound" });
    expect(await finishSnapshot(ctx, fixture.userId, fixture.start, transport)).toEqual({
      ok: false,
      error: { kind: "invalid_state" },
    });
    expect(transport).not.toHaveBeenCalled();
    const [attempt] = await ctx.db
      .select({ consumedAt: calendarOAuthAttempts.consumedAt })
      .from(calendarOAuthAttempts)
      .where(eq(calendarOAuthAttempts.stateHash, hashCalendarOAuthToken(fixture.start.state)));
    expect(attempt).toEqual({ consumedAt: null });
    expect(await listCalendarProviderAccounts(ctx.db, fixture.userId, signal())).toEqual(
      fixture.before,
    );
    await expectSnapshotRefresh(ctx, fixture.userId, fixture.accountId, "refresh-secret");
  },
);

it("a valid durable snapshot changed after consumption cannot be rebased during code exchange", async () => {
  const fixture = await snapshotFixture(ctx, true);
  const pending = await blockedSnapshotExchange(ctx, fixture.userId, fixture.start);
  try {
    await rewriteSnapshot(
      ctx,
      fixture.start.state,
      { [fixture.accountId]: fixture.generation + 1 },
      fixture.generation,
    );
  } finally {
    pending.release.resolve();
    await pending.finishing;
  }
  expect(await pending.finishing).toEqual({ ok: false, error: { kind: "invalid_state" } });
  expect(await listCalendarProviderAccounts(ctx.db, fixture.userId, signal())).toEqual(
    fixture.before,
  );
  await expectSnapshotRefresh(ctx, fixture.userId, fixture.accountId, "refresh-secret");
});

it("an untargeted callback already exchanging its code cannot restore a reauthRequired grant", async () => {
  const fixture = await snapshotFixture(ctx);
  const pending = await blockedSnapshotExchange(
    ctx,
    fixture.userId,
    fixture.start,
    "obsolete-untargeted-reauth-refresh",
  );
  const invalidGrant: GoogleTransport = () =>
    Promise.resolve(new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));
  try {
    expect(
      await getCalendarAccessGrant(
        ctx.db,
        fixture.userId,
        fixture.accountId,
        calendarTestConfig,
        signal(),
        { transport: invalidGrant },
      ),
    ).toEqual({ ok: false, error: { kind: "unauthorized", status: 400 } });
  } finally {
    pending.release.resolve();
    await pending.finishing;
  }
  expect((await pending.finishing).ok).toBe(false);
  expect(await listCalendarProviderAccounts(ctx.db, fixture.userId, signal())).toMatchObject({
    ok: true,
    value: [
      { id: fixture.accountId, status: "reauthRequired", emailAddress: "external@example.invalid" },
    ],
  });
  const transport = calendarTestTransport();
  expect(
    await getCalendarAccessGrant(
      ctx.db,
      fixture.userId,
      fixture.accountId,
      calendarTestConfig,
      signal(),
      { transport },
    ),
  ).toEqual({ ok: false, error: { kind: "disconnected" } });
  expect(transport).not.toHaveBeenCalled();
});
