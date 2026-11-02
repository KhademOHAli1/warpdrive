// Follow-on authority regression, separate from deal write-version qualification.
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import { expect, test } from "vitest";
import { dealMovedChannel } from "@/constants/boardChannels";
import { ERROR_IDS } from "@/constants/errorIds";
import * as schema from "@/db/schema";
import { deals, permissionSets } from "@/db/schema";
import { loadLiveSessionByToken } from "@/features/auth/session";
import { hydrateActor } from "@/server/hydrateActor";
import { makeTestDb, type TestDb } from "@/test/db";
import { createIntegrationPlatformFixtures } from "@/test/integrationPlatformFixtures";
import { loadEditableDeal } from "./dealAuth";
import { moveDeal } from "./dealMove";
import type { NativeMoveSession } from "./dealMoveAuthority";
import { installDealWriteVersionFixture } from "./dealWriteVersion.test-helpers";

type MoveResult = Awaited<ReturnType<typeof moveDeal>>;
type MoveOutcome = { kind: "result"; value: MoveResult } | { kind: "thrown"; error: unknown };
type RaceRun = {
  mover?: Promise<MoveOutcome>;
  locker?: PoolClient;
  lockerOpen: boolean;
};
type Snapshot = {
  row: unknown;
  audit: unknown[];
  channel: { version: string; updatedAt: string }[];
};

// A promise deadline does not cancel SQL. Server-side timeouts and retiring only
// this test's borrowed clients supply the remaining cleanup bounds.
async function within<T>(pending: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}: deadline exceeded`)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function backendPid(client: PoolClient): Promise<number> {
  const result = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
  const pid = result.rows[0]?.pid;
  if (pid === undefined) throw new Error("fixture backend PID is missing");
  return pid;
}

async function waitForBlockedDealRowLock(
  observer: PoolClient,
  moverPid: number,
  lockerPid: number,
): Promise<void> {
  const deadline = performance.now() + 3_000;
  while (performance.now() < deadline) {
    await observer.query("SELECT pg_stat_clear_snapshot()");
    const result = await observer.query<{
      state: string;
      waitType: string | null;
      blockedByLocker: boolean;
      dealRowLock: boolean;
    }>(
      `SELECT a.state, a.wait_event_type AS "waitType",
              $2::integer = ANY(pg_blocking_pids(a.pid)) AS "blockedByLocker",
              (a.query ~* '^update[[:space:]]+"?deals"?[[:space:]]+set'
               OR a.query ~* '^select[[:space:]].*[[:space:]]from[[:space:]]+"?deals"?[[:space:]]+where[[:space:]].*[[:space:]]for[[:space:]]+update[[:space:]]*$') AS "dealRowLock"
         FROM pg_stat_activity AS a
        WHERE a.pid = $1 AND a.datname = current_database()`,
      [moverPid, lockerPid],
    );
    const row = result.rows[0];
    if (
      row?.state === "active" &&
      row.waitType === "Lock" &&
      row.blockedByLocker &&
      row.dealRowLock
    )
      return;
    // Polling only paces the observations; the exact SQL lock witness orders the race.
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("mover did not reach the locker-blocked deal-row lock within 3 seconds");
}

async function snapshot(client: PoolClient, dealId: string, channel: string): Promise<Snapshot> {
  // Preserve database timestamp microseconds and every persisted deal field, including its nonce.
  const row = await client.query<{ value: unknown }>(
    "SELECT to_jsonb(d) AS value FROM deals AS d WHERE d.id = $1",
    [dealId],
  );
  if (row.rows.length !== 1) throw new Error("fixture deal disappeared");
  const audit = await client.query<{ value: unknown }>(
    `SELECT to_jsonb(c) AS value FROM change_logs AS c
      WHERE c.entity_type = 'deal' AND c.entity_id = $1 ORDER BY c.id`,
    [dealId],
  );
  const version = await client.query<{ version: string; updatedAt: string }>(
    `SELECT version::text AS version, updated_at::text AS "updatedAt"
       FROM channel_versions WHERE channel = $1`,
    [channel],
  );
  return {
    row: row.rows[0]?.value,
    audit: audit.rows.map((item) => item.value),
    channel: version.rows,
  };
}

function resultSummary(outcome: MoveOutcome) {
  if (outcome.kind === "thrown") return { kind: "thrown", message: String(outcome.error) };
  return outcome.value.ok
    ? { kind: "result", ok: true }
    : { kind: "result", ok: false, errorId: outcome.value.error.id };
}

async function captureNativeEditor(h: TestDb, signal: AbortSignal) {
  const seeded = await createIntegrationPlatformFixtures(
    h,
    // Native session expiry is evaluated against the real database clock.
    { namespace: "moveactorfreshness", now: new Date() },
    signal,
  );
  if (!seeded.ok) throw new Error(`native fixture setup failed: ${seeded.error.code}`);
  const f = seeded.value;
  const live = await loadLiveSessionByToken(h.db, f.sessions.member.token, signal);
  if (!live.ok) throw new Error("native fixture session was not accepted");
  expect(live.value).toEqual({ userId: f.users.member.id, sessionId: f.sessions.member.id });
  const actor = await hydrateActor(h.db, live.value.userId, signal);
  if (actor === null) throw new Error("native fixture actor was not hydrated");
  expect(actor.type).toBe("regular");
  expect(actor.isActive).toBe(true);
  expect(actor.flags.has("deal.edit_own")).toBe(true);
  const nativeSession: NativeMoveSession = live.value;
  return { f, actor, live: nativeSession };
}

async function preparePermissionRace(h: TestDb) {
  expect(h.pool.options.max).toBe(4);
  h.pool.options.connectionTimeoutMillis = 2_000;
  await installDealWriteVersionFixture(h.pool);
  const { f, actor, live } = await captureNativeEditor(h, AbortSignal.timeout(10_000));
  const dealId = f.deals.visible.id;
  // Finish fixture arrangement before capturing the human command's snapshot/token.
  const [baseline] = await h.db
    .update(deals)
    .set({ boardPosition: "2" })
    .where(eq(deals.id, dealId))
    .returning();
  if (baseline === undefined) throw new Error("fixture baseline deal is missing");
  expect(baseline.ownerId).toBe(actor.id);
  expect(baseline.boardPosition).toBe("2");
  const permissionSetId = f.users.member.permissionSetId;
  if (permissionSetId === null) throw new Error("native member permission set is missing");
  const [permissionSet] = await h.db
    .select()
    .from(permissionSets)
    .where(eq(permissionSets.id, permissionSetId));
  if (permissionSet === undefined) throw new Error("native member permission set row is missing");
  return { f, actor, live, dealId, baseline, permissionSetId, permissionSet };
}

async function releaseLocker(
  run: RaceRun,
  retire: (client: PoolClient) => void,
  failures: unknown[],
): Promise<void> {
  const locker = run.locker;
  if (locker === undefined) return;
  if (run.lockerOpen) {
    try {
      await within(locker.query("ROLLBACK"), 3_000, "locker rollback");
      run.lockerOpen = false;
    } catch (error) {
      failures.push(error);
    }
  }
  try {
    retire(locker);
  } catch (error) {
    failures.push(error);
  }
}

test("a native deal move rejects a permission downgrade committed during its deal-row-lock wait", async () => {
  const h = await makeTestDb();
  const owned: PoolClient[] = [];
  const retired = new Set<PoolClient>();
  const clientErrors: Error[] = [];
  const failures: unknown[] = [];
  const run: RaceRun = { lockerOpen: false };
  const track = (client: PoolClient) => {
    client.on("error", (error: Error) => clientErrors.push(error));
    owned.push(client);
    return client;
  };
  const retire = (client: PoolClient) => {
    if (retired.has(client)) return;
    retired.add(client);
    client.release(true);
  };
  try {
    const { f, actor, live, dealId, baseline, permissionSetId, permissionSet } =
      await preparePermissionRace(h);

    const locker = track(await h.pool.connect());
    run.locker = locker;
    const mover = track(await h.pool.connect());
    const observer = track(await h.pool.connect());
    await locker.query("SET statement_timeout = '2000ms'");
    await locker.query("SET idle_in_transaction_session_timeout = '10000ms'");
    await mover.query("SET statement_timeout = '10000ms'");
    await mover.query("SET lock_timeout = '8000ms'");
    await observer.query("SET statement_timeout = '1000ms'");
    const lockerPid = await backendPid(locker);
    const moverPid = await backendPid(mover);
    expect(moverPid).not.toBe(lockerPid);
    const moverDb = drizzle(mover, { schema });
    const observerDb = drizzle(observer, { schema });
    const channel = dealMovedChannel(baseline.pipelineId);
    const before = await snapshot(observer, dealId, channel);
    expect(before.row).toMatchObject({ write_version: baseline.writeVersion });

    await locker.query("BEGIN");
    run.lockerOpen = true;
    // A lock alone never rotates write_version. No competing deal writer participates.
    await locker.query("SELECT id FROM deals WHERE id = $1 FOR UPDATE", [dealId]);
    run.mover = moveDeal(
      moverDb,
      actor,
      {
        dealId,
        toStageId: baseline.stageId,
        beforePosition: "10",
        afterPosition: "20",
        expectedWriteVersion: baseline.writeVersion,
      },
      AbortSignal.timeout(12_000),
      live,
    ).then(
      (value): MoveOutcome => ({ kind: "result", value }),
      (error: unknown): MoveOutcome => {
        failures.push(error);
        return { kind: "thrown", error };
      },
    );
    await waitForBlockedDealRowLock(observer, moverPid, lockerPid);

    // This autocommit UPDATE acknowledges the downgrade while the deal-row lock waits.
    // It follows the existing actor-freshness fixture's SQL authority mutation; no HTTP
    // permission-editor or browser authentication-flow claim is made by this regression.
    const revoked = await observerDb
      .update(permissionSets)
      .set({ flags: { ...permissionSet.flags, "deal.edit_own": false } })
      .where(eq(permissionSets.id, permissionSetId))
      .returning({ id: permissionSets.id });
    expect(revoked).toEqual([{ id: permissionSetId }]);
    const checkSignal = AbortSignal.timeout(4_000);
    const stillLive = await loadLiveSessionByToken(
      observerDb,
      f.sessions.member.token,
      checkSignal,
    );
    expect(stillLive).toEqual({ ok: true, value: live });
    const current = await hydrateActor(observerDb, actor.id, checkSignal);
    if (current === null)
      throw new Error("permission downgrade unexpectedly deactivated the owner");
    expect(current.flags.has("deal.edit_own")).toBe(false);
    expect(actor.flags.has("deal.edit_own")).toBe(true);
    expect(await loadEditableDeal(observerDb, current, dealId, checkSignal)).toMatchObject({
      ok: false,
      error: { id: ERROR_IDS.PERM_DENIED },
    });
    const whileBlocked = await snapshot(observer, dealId, channel);
    expect(whileBlocked.row).toMatchObject({ write_version: baseline.writeVersion });
    expect(whileBlocked).toEqual(before);
    // Reconfirm the same blocker after the committed downgrade and unchanged target checks.
    await waitForBlockedDealRowLock(observer, moverPid, lockerPid);

    await locker.query("COMMIT");
    run.lockerOpen = false;
    // Never join the mover until the owned locker has acknowledged release.
    const outcome = await within(run.mover, 3_000, "move after permission downgrade");
    const after = await snapshot(observer, dealId, channel);
    expect({ outcome: resultSummary(outcome), persisted: after }).toEqual({
      outcome: { kind: "result", ok: false, errorId: ERROR_IDS.PERM_DENIED },
      persisted: before,
    });
  } catch (error) {
    failures.push(error);
  } finally {
    // Release/destroy the blocker before awaiting any outstanding mover. Retain rollback,
    // late mover, connection and harness-close failures alongside the original test failure.
    await releaseLocker(run, retire, failures);
    try {
      if (run.mover !== undefined) await within(run.mover, 3_000, "mover cleanup");
    } catch (error) {
      failures.push(error);
    }
    for (const client of owned) {
      try {
        retire(client);
      } catch (error) {
        failures.push(error);
      }
    }
    try {
      if (run.mover !== undefined) await within(run.mover, 2_000, "mover retirement");
    } catch (error) {
      failures.push(error);
    }
    try {
      await h.close();
    } catch (error) {
      failures.push(error);
    }
    if (clientErrors.length > 0)
      failures.push(new AggregateError(clientErrors, "owned fixture client emitted an error"));
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, "actor freshness race and cleanup failed");
}, 30_000);
