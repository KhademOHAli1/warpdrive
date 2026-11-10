import { afterEach, beforeEach, expect, it } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { seedUser } from "@/db/testing/factories";
import { makeTestDb } from "@/test/db";
import { finishCalendarAuthorization } from "./accountAuthorization";
import { disconnectCalendarProviderAccount, listCalendarProviderAccounts } from "./accounts";
import {
  beginTestCalendar,
  calendarTestConfig,
  calendarTestTransport,
  connectTestCalendar,
  deferredValue,
  calendarTestSignal as signal,
} from "./accountTestHelpers";
import { getCalendarAccessGrant } from "./accountTokens";
import type { GoogleTransport } from "./contracts";

let ctx: Awaited<ReturnType<typeof makeTestDb>>;
beforeEach(async () => {
  ctx = await makeTestDb();
});
afterEach(async () => {
  await ctx.close();
});

async function reachedGate<T>(began: Promise<void>, running: Promise<T>) {
  await Promise.race([
    began,
    running.then(() => {
      throw new AppError(ERROR_IDS.DB_INVARIANT, "operation ended before synthetic provider gate");
    }),
  ]);
}
async function expectCurrentRefresh(userId: string, accountId: string, expected: string) {
  const used: string[] = [];
  const response = calendarTestTransport({ refreshToken: "post-check-rotation" });
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

it("an untargeted Connect already exchanging its code cannot restore a locally disconnected same-subject account", async () => {
  const owner = await seedUser(ctx.db);
  const connected = await connectTestCalendar(ctx.db, owner.id);
  const start = await beginTestCalendar(ctx.db, owner.id);
  const began = deferredValue<void>();
  const release = deferredValue<void>();
  const response = calendarTestTransport({
    email: "stale-connect@example.invalid",
    refreshToken: "stale-untargeted-refresh",
  });
  const finishing = finishCalendarAuthorization(
    ctx.db,
    owner.id,
    calendarTestConfig,
    { ...start, code: "untargeted-existing-account-code" },
    signal(),
    {
      transport: async (url, init) => {
        if (url.endsWith("/token")) {
          began.resolve();
          await release.promise;
        }
        return response(url, init);
      },
    },
  );
  await reachedGate(began.promise, finishing);
  try {
    expect(
      (await disconnectCalendarProviderAccount(ctx.db, owner.id, connected.accountId, signal())).ok,
    ).toBe(true);
  } finally {
    release.resolve();
    await finishing;
  }
  expect((await finishing).ok).toBe(false);
  expect(await listCalendarProviderAccounts(ctx.db, owner.id, signal())).toMatchObject({
    ok: true,
    value: [
      { id: connected.accountId, status: "disconnected", emailAddress: "external@example.invalid" },
    ],
  });
  const transport = calendarTestTransport();
  expect(
    (
      await getCalendarAccessGrant(
        ctx.db,
        owner.id,
        connected.accountId,
        calendarTestConfig,
        signal(),
        { transport },
      )
    ).ok,
  ).toBe(false);
  expect(transport).not.toHaveBeenCalled();
});

it("an older untargeted Connect begun before any account cannot replace a newer same-subject connection", async () => {
  const owner = await seedUser(ctx.db);
  const older = await beginTestCalendar(ctx.db, owner.id);
  const newer = await beginTestCalendar(ctx.db, owner.id);
  const current = await finishCalendarAuthorization(
    ctx.db,
    owner.id,
    calendarTestConfig,
    { ...newer, code: "newer-untargeted-code" },
    signal(),
    {
      transport: calendarTestTransport({
        email: "newer-account@example.invalid",
        refreshToken: "newer-account-refresh",
      }),
    },
  );
  expect(current.ok).toBe(true);
  if (!current.ok) throw new AppError(ERROR_IDS.DB_INVARIANT, "newer account fixture failed");
  const stale = await finishCalendarAuthorization(
    ctx.db,
    owner.id,
    calendarTestConfig,
    { ...older, code: "older-untargeted-code" },
    signal(),
    {
      transport: calendarTestTransport({
        email: "older-account@example.invalid",
        refreshToken: "older-account-refresh",
      }),
    },
  );
  expect(stale.ok).toBe(false);
  expect(await listCalendarProviderAccounts(ctx.db, owner.id, signal())).toMatchObject({
    ok: true,
    value: [
      {
        id: current.value.accountId,
        status: "connected",
        emailAddress: "newer-account@example.invalid",
      },
    ],
  });
  await expectCurrentRefresh(owner.id, current.value.accountId, "newer-account-refresh");
});

it("untargeted different-subject flows for the same owner can finish out of order independently", async () => {
  const owner = await seedUser(ctx.db);
  const older = await beginTestCalendar(ctx.db, owner.id);
  const newer = await beginTestCalendar(ctx.db, owner.id);
  const first = await finishCalendarAuthorization(
    ctx.db,
    owner.id,
    calendarTestConfig,
    { ...newer, code: "newer-independent-code" },
    signal(),
    {
      transport: calendarTestTransport({
        subject: "independent-beta-subject",
        email: "beta@example.invalid",
        refreshToken: "beta-independent-refresh",
      }),
    },
  );
  expect(first.ok).toBe(true);
  if (!first.ok) throw new AppError(ERROR_IDS.DB_INVARIANT, "newer independent bind failed");
  const second = await finishCalendarAuthorization(
    ctx.db,
    owner.id,
    calendarTestConfig,
    { ...older, code: "older-independent-code" },
    signal(),
    {
      transport: calendarTestTransport({
        subject: "independent-alpha-subject",
        email: "alpha@example.invalid",
        refreshToken: "alpha-independent-refresh",
      }),
    },
  );
  expect(second.ok).toBe(true);
  if (!second.ok) throw new AppError(ERROR_IDS.DB_INVARIANT, "older independent bind failed");
  expect(second.value.accountId).not.toBe(first.value.accountId);
  const accounts = await listCalendarProviderAccounts(ctx.db, owner.id, signal());
  expect(accounts.ok).toBe(true);
  if (!accounts.ok) throw new AppError(ERROR_IDS.DB_INVARIANT, "independent account list failed");
  expect(accounts.value).toHaveLength(2);
  expect(accounts.value).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: first.value.accountId,
        emailAddress: "beta@example.invalid",
        status: "connected",
      }),
      expect.objectContaining({
        id: second.value.accountId,
        emailAddress: "alpha@example.invalid",
        status: "connected",
      }),
    ]),
  );
  await expectCurrentRefresh(owner.id, first.value.accountId, "beta-independent-refresh");
  await expectCurrentRefresh(owner.id, second.value.accountId, "alpha-independent-refresh");
});

it.each(["success", "invalid_grant"] as const)(
  "an old refresh returning %s after a new bind cannot overwrite or clear the new grant",
  async (outcome) => {
    const owner = await seedUser(ctx.db);
    const connected = await connectTestCalendar(ctx.db, owner.id);
    const began = deferredValue<void>();
    const release = deferredValue<void>();
    const transport: GoogleTransport = async () => {
      began.resolve();
      await release.promise;
      return outcome === "success"
        ? new Response(
            JSON.stringify({
              access_token: "obsolete-access-token",
              refresh_token: "obsolete-refresh-token",
              expires_in: 3600,
              token_type: "Bearer",
            }),
          )
        : new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
    };
    const refreshing = getCalendarAccessGrant(
      ctx.db,
      owner.id,
      connected.accountId,
      calendarTestConfig,
      signal(),
      { transport },
    );
    await reachedGate(began.promise, refreshing);
    try {
      const replacement = await beginTestCalendar(ctx.db, owner.id, connected.accountId);
      expect(
        await finishCalendarAuthorization(
          ctx.db,
          owner.id,
          calendarTestConfig,
          { ...replacement, code: "new-grant-while-refreshing" },
          signal(),
          {
            transport: calendarTestTransport({
              email: "new-binding@example.invalid",
              refreshToken: "new-binding-refresh",
            }),
          },
        ),
      ).toEqual({ ok: true, value: { accountId: connected.accountId } });
    } finally {
      release.resolve();
      await refreshing;
    }
    const stale = await refreshing;
    expect(stale.ok).toBe(false);
    expect(JSON.stringify(stale)).not.toContain("obsolete-access-token");
    expect(await listCalendarProviderAccounts(ctx.db, owner.id, signal())).toMatchObject({
      ok: true,
      value: [
        {
          id: connected.accountId,
          status: "connected",
          emailAddress: "new-binding@example.invalid",
        },
      ],
    });
    await expectCurrentRefresh(owner.id, connected.accountId, "new-binding-refresh");
  },
);
