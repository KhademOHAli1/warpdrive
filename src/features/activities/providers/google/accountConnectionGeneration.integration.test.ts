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

async function rotateLiveToken(userId: string, accountId: string) {
  const refreshed = await getCalendarAccessGrant(
    ctx.db,
    userId,
    accountId,
    calendarTestConfig,
    signal(),
    {
      transport: calendarTestTransport({ refreshToken: "ordinary-rotation" }),
    },
  );
  expect(refreshed.ok).toBe(true);
}
async function expectRefreshCredential(userId: string, accountId: string, expected: string) {
  const used: string[] = [];
  const response = calendarTestTransport({ refreshToken: "post-verification-rotation" });
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
async function inFlightReconnect(userId: string, accountId: string) {
  const start = await beginTestCalendar(ctx.db, userId, accountId);
  const began = deferredValue<void>();
  const release = deferredValue<void>();
  const normal = calendarTestTransport({
    email: "pending-consent@example.invalid",
    refreshToken: "pending-consent-refresh",
  });
  const result = finishCalendarAuthorization(
    ctx.db,
    userId,
    calendarTestConfig,
    { ...start, code: "pending-reconnect-code" },
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
  await Promise.race([
    began.promise,
    result.then(() => {
      throw new AppError(
        ERROR_IDS.DB_INVARIANT,
        "callback ended before the synthetic exchange gate",
      );
    }),
  ]);
  return { result, release };
}

it("an ordinary successful refresh after begin does not invalidate the same connection's reconnect attempt", async () => {
  const owner = await seedUser(ctx.db);
  const connected = await connectTestCalendar(ctx.db, owner.id);
  const start = await beginTestCalendar(ctx.db, owner.id, connected.accountId);
  await rotateLiveToken(owner.id, connected.accountId);
  const finished = await finishCalendarAuthorization(
    ctx.db,
    owner.id,
    calendarTestConfig,
    { ...start, code: "same-live-connection-code" },
    signal(),
    {
      transport: calendarTestTransport({
        email: "reconnected@example.invalid",
        refreshToken: "fresh-reconnect-refresh",
      }),
    },
  );
  expect(finished).toEqual({ ok: true, value: { accountId: connected.accountId } });
  expect(await listCalendarProviderAccounts(ctx.db, owner.id, signal())).toMatchObject({
    ok: true,
    value: [
      { id: connected.accountId, status: "connected", emailAddress: "reconnected@example.invalid" },
    ],
  });
  await expectRefreshCredential(owner.id, connected.accountId, "fresh-reconnect-refresh");
});

it("an ordinary successful refresh during code exchange does not invalidate the same live reconnect", async () => {
  const owner = await seedUser(ctx.db);
  const connected = await connectTestCalendar(ctx.db, owner.id);
  const pending = await inFlightReconnect(owner.id, connected.accountId);
  try {
    await rotateLiveToken(owner.id, connected.accountId);
  } finally {
    pending.release.resolve();
    await pending.result;
  }
  expect(await pending.result).toEqual({ ok: true, value: { accountId: connected.accountId } });
  await expectRefreshCredential(owner.id, connected.accountId, "pending-consent-refresh");
});

it.each(["disconnect", "replacement reconnect", "reauth invalidation"] as const)(
  "%s rejects an older in-flight attempt without overwriting its authoritative connection state",
  async (change) => {
    const owner = await seedUser(ctx.db);
    const stranger = await seedUser(ctx.db);
    const connected = await connectTestCalendar(ctx.db, owner.id);
    const pending = await inFlightReconnect(owner.id, connected.accountId);
    try {
      if (change === "disconnect") {
        expect(
          (await disconnectCalendarProviderAccount(ctx.db, owner.id, connected.accountId, signal()))
            .ok,
        ).toBe(true);
      } else if (change === "replacement reconnect") {
        const replacement = await beginTestCalendar(ctx.db, owner.id, connected.accountId);
        const finished = await finishCalendarAuthorization(
          ctx.db,
          owner.id,
          calendarTestConfig,
          { ...replacement, code: "replacement-connection-code" },
          signal(),
          {
            transport: calendarTestTransport({
              email: "replacement@example.invalid",
              refreshToken: "replacement-connection-refresh",
            }),
          },
        );
        expect(finished).toEqual({ ok: true, value: { accountId: connected.accountId } });
      } else {
        const transport: GoogleTransport = () =>
          Promise.resolve(
            new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
          );
        const revoked = await getCalendarAccessGrant(
          ctx.db,
          owner.id,
          connected.accountId,
          calendarTestConfig,
          signal(),
          { transport },
        );
        expect(revoked).toEqual({ ok: false, error: { kind: "unauthorized", status: 400 } });
      }
    } finally {
      pending.release.resolve();
      await pending.result;
    }
    expect((await pending.result).ok).toBe(false);
    expect(await listCalendarProviderAccounts(ctx.db, stranger.id, signal())).toEqual({
      ok: true,
      value: [],
    });
    const status =
      change === "disconnect"
        ? "disconnected"
        : change === "reauth invalidation"
          ? "reauthRequired"
          : "connected";
    const emailAddress =
      change === "replacement reconnect"
        ? "replacement@example.invalid"
        : "external@example.invalid";
    expect(await listCalendarProviderAccounts(ctx.db, owner.id, signal())).toMatchObject({
      ok: true,
      value: [{ id: connected.accountId, status, emailAddress }],
    });
    if (change === "replacement reconnect")
      await expectRefreshCredential(
        owner.id,
        connected.accountId,
        "replacement-connection-refresh",
      );
    else {
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
    }
  },
);
