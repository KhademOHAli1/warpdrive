import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import {
  calendarOAuthAttempts,
  calendarProviderAccounts,
} from "@/db/schema/calendarProviderAccounts";
import { seedUser } from "@/db/testing/factories";
import { makeTestDb } from "@/test/db";
import { finishCalendarAuthorization } from "./accountAuthorization";
import {
  beginTestCalendar,
  calendarTestConfig,
  calendarTestTransport,
  connectTestCalendar,
  deferredValue,
} from "./accountTestHelpers";
import { hashCalendarOAuthToken } from "./authorization";
import { forbidProviderNetwork } from "./calendarCatalog.test-helpers";
import type { GoogleTransport } from "./contracts";

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

async function waitForGate<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () =>
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new AppError(ERROR_IDS.DB_INVARIANT, "expiry lock gate aborted"),
      );
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    if (onAbort !== undefined) signal.removeEventListener("abort", onAbort);
  }
}

async function crossOwnerLock<T>(userId: string, start: () => Promise<T>, advance: () => void) {
  const holder = await ctx.pool.connect();
  let running: Promise<T> | undefined;
  let released = false;
  try {
    await holder.query("BEGIN");
    await holder.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [userId]);
    const pid = (await holder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]
      ?.pid;
    if (pid === undefined) throw new AppError(ERROR_IDS.DB_INVARIANT, "owner lock PID missing");
    running = start();
    await expect
      .poll(
        async () => {
          const blocked = await ctx.pool.query<{ waiting: boolean }>(
            "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND $1::integer=ANY(pg_blocking_pids(pid))) AS waiting",
            [pid],
          );
          return blocked.rows[0]?.waiting === true;
        },
        { timeout: 1_500, interval: 10 },
      )
      .toBe(true);
    // Logical time advances only after PostgreSQL proves this operation is waiting.
    advance();
    await holder.query("ROLLBACK");
    released = true;
    return await running;
  } finally {
    try {
      if (!released) await holder.query("ROLLBACK");
    } finally {
      holder.release(!released);
      await running?.catch(() => undefined);
    }
  }
}

it("consume rechecks expiry after the owner lock wait and never exchanges an expired code", async () => {
  const owner = await seedUser(ctx.db);
  const start = await beginTestCalendar(ctx.db, owner.id);
  const expiry = Date.parse(start.expiresAt);
  let now = new Date(expiry - 1);
  const transport = calendarTestTransport();
  const result = await crossOwnerLock(
    owner.id,
    () =>
      finishCalendarAuthorization(
        ctx.db,
        owner.id,
        calendarTestConfig,
        { ...start, code: "consume-expiry-lock-code" },
        AbortSignal.timeout(3_000),
        { transport, now: () => now },
      ),
    () => {
      now = new Date(expiry + 1);
    },
  );
  const [attempt] = await ctx.db
    .select()
    .from(calendarOAuthAttempts)
    .where(eq(calendarOAuthAttempts.stateHash, hashCalendarOAuthToken(start.state)));
  expect(transport).not.toHaveBeenCalled();
  expect(result).toEqual({ ok: false, error: { kind: "invalid_state" } });
  expect(attempt?.consumedAt).toBeNull();
  expect(attempt?.codeVerifierEnc).not.toBeNull();
  expect(await ctx.db.select().from(calendarProviderAccounts)).toHaveLength(0);
});

it("bind rechecks expiry after the owner lock wait and preserves the existing grant", async () => {
  const owner = await seedUser(ctx.db);
  const connected = await connectTestCalendar(ctx.db, owner.id);
  const [before] = await ctx.db
    .select()
    .from(calendarProviderAccounts)
    .where(eq(calendarProviderAccounts.id, connected.accountId));
  const start = await beginTestCalendar(ctx.db, owner.id, connected.accountId);
  const expiry = Date.parse(start.expiresAt);
  let now = new Date(expiry - 1);
  const entered = deferredValue<void>();
  const release = deferredValue<void>();
  const deadline = AbortSignal.timeout(3_000);
  const upstream = calendarTestTransport({
    email: "expired-consent@example.invalid",
    refreshToken: "expired-consent-replacement",
  });
  const response: GoogleTransport = upstream;
  const running = finishCalendarAuthorization(
    ctx.db,
    owner.id,
    calendarTestConfig,
    { ...start, code: "bind-expiry-lock-code" },
    deadline,
    {
      now: () => now,
      transport: async (url, init) => {
        if (url.endsWith("/userinfo")) {
          entered.resolve();
          await waitForGate(release.promise, init.signal);
        }
        init.signal.throwIfAborted();
        return response(url, init);
      },
    },
  );
  try {
    await waitForGate(
      Promise.race([
        entered.promise,
        running.then(() => {
          throw new AppError(ERROR_IDS.DB_INVARIANT, "callback missed identity gate");
        }),
      ]),
      deadline,
    );
    const result = await crossOwnerLock(
      owner.id,
      () => {
        release.resolve();
        return running;
      },
      () => {
        now = new Date(expiry + 1);
      },
    );
    const [after] = await ctx.db
      .select()
      .from(calendarProviderAccounts)
      .where(eq(calendarProviderAccounts.id, connected.accountId));
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ok: false, error: { kind: "invalid_state" } });
    expect(after).toEqual(before);
  } finally {
    release.resolve();
    await running.catch(() => undefined);
  }
});
