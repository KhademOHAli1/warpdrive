// Regression fixture for a stale move after an observed competing row lock.
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { dealMovedChannel } from "@/constants/boardChannels";
import { ERROR_IDS } from "@/constants/errorIds";
import * as schema from "@/db/schema";
import { deals } from "@/db/schema/deals";
import { pipelines } from "@/db/schema/pipelines";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { makeTestDb, type TestDb } from "@/test/db";
import { createDeal, moveDeal } from "./dealActions";
import { adminSession, createSession, seedSettings } from "./dealMove.test-helpers";
import { installDealWriteVersionFixture } from "./dealWriteVersion.test-helpers";

const T0 = "2001-02-02T10:00:00.000000Z";
const T1 = "2001-02-02T10:00:00.000500Z";
const expectedUpdatedAt = new Date(T0).toISOString();
type MoveResult = Awaited<ReturnType<typeof moveDeal>>;
type MoveOutcome = { kind: "result"; value: MoveResult } | { kind: "thrown"; error: unknown };
type Snapshot = {
  row: unknown;
  audit: unknown[];
  channel: { version: string; updatedAt: string }[];
};

// This timeout bounds awaiting an owned promise. It does not cancel its SQL.
// Server-side timeouts and final destruction of owned clients supply cleanup.
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
  writerPid: number,
): Promise<void> {
  const deadline = performance.now() + 3_000;
  while (performance.now() < deadline) {
    await observer.query("SELECT pg_stat_clear_snapshot()");
    const result = await observer.query<{
      state: string;
      waitType: string | null;
      blockedByWriter: boolean;
      dealRowLock: boolean;
    }>(
      `SELECT a.state, a.wait_event_type AS "waitType",
              $2::integer = ANY(pg_blocking_pids(a.pid)) AS "blockedByWriter",
              (a.query ~* '^update[[:space:]]+"?deals"?[[:space:]]+set'
               OR a.query ~* '^select[[:space:]].*[[:space:]]from[[:space:]]+"?deals"?[[:space:]]+where[[:space:]].*[[:space:]]for[[:space:]]+update[[:space:]]*$') AS "dealRowLock"
         FROM pg_stat_activity AS a
        WHERE a.pid = $1 AND a.datname = current_database()`,
      [moverPid, writerPid],
    );
    const row = result.rows[0];
    if (
      row?.state === "active" &&
      row.waitType === "Lock" &&
      row.blockedByWriter &&
      row.dealRowLock
    )
      return;
    // A bounded polling interval only paces queries; the lock witness orders the race.
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("stale mover did not reach the writer-blocked deal-row lock within 3 seconds");
}

async function snapshot(client: PoolClient, dealId: string, channel: string): Promise<Snapshot> {
  // JSON/text snapshots retain PostgreSQL timestamp microseconds that JS Date loses.
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

async function prepareStageRace(h: TestDb) {
  await installDealWriteVersionFixture(h.pool);
  expect(h.pool.options.max).toBe(4);
  // The isolated harness owns this pool. Bound later fixture-client acquisition.
  h.pool.options.connectionTimeoutMillis = 2_000;
  await seedSettings(h.db);
  const user = await seedUser(h.db, { isAdmin: true });
  const { pipeline, stages } = await seedPipelineWithStages(h.db, ["A", "B"]);
  const first = stages[0];
  const second = stages[1];
  if (first === undefined || second === undefined) throw new Error("missing fixture stages");
  // Supplied domain actor: no native session/authentication or provider claim.
  const actor = adminSession(user.id);
  const created = await createDeal(
    h.db,
    createSession(user.id),
    { title: "Concurrent stage move", pipelineId: pipeline.id, stageId: first.id },
    AbortSignal.timeout(10_000),
  );
  if (!created.ok) throw created.error;
  const dealId = created.value.id;
  const channel = dealMovedChannel(pipeline.id);
  await h.pool.query(
    `UPDATE deals SET updated_at = $2::timestamptz,
                      stage_entered_at = $2::timestamptz,
                      board_position = '2' WHERE id = $1`,
    [dealId, T0],
  );
  const [baseline] = await h.db.select().from(deals).where(eq(deals.id, dealId)).limit(1);
  if (baseline === undefined) throw new Error("fixture baseline deal is missing");
  expect(baseline.stageId).toBe(first.id);
  expect(baseline.boardPosition).toBe("2");
  expect(baseline.updatedAt.toISOString()).toBe(expectedUpdatedAt);
  return { pipeline, first, second, actor, dealId, channel, baseline };
}

describe("moveDeal rejects a stale stage move after a same-millisecond winner", () => {
  it("preserves the committed winner row, audit and channel version", async () => {
    const h = await makeTestDb();
    const owned: PoolClient[] = [];
    const clientErrors: Error[] = [];
    const failures: unknown[] = [];
    const run: { stale?: Promise<MoveOutcome>; winner?: Snapshot } = {};
    const track = (client: PoolClient) => {
      client.on("error", (error: Error) => clientErrors.push(error));
      owned.push(client);
      return client;
    };
    try {
      const { pipeline, first, second, actor, dealId, channel, baseline } =
        await prepareStageRace(h);

      const writer = track(await h.pool.connect());
      const mover = track(await h.pool.connect());
      const observer = track(await h.pool.connect());
      await writer.query("SET statement_timeout = '2000ms'");
      await writer.query("SET idle_in_transaction_session_timeout = '10000ms'");
      await mover.query("SET statement_timeout = '8000ms'");
      await mover.query("SET lock_timeout = '6000ms'");
      await observer.query("SET statement_timeout = '1000ms'");
      const writerPid = await backendPid(writer);
      const moverPid = await backendPid(mover);
      const writerDb = drizzle(writer, { schema });
      const moverDb = drizzle(mover, { schema });

      // Any callback failure rolls the writer back before control reaches the outer finally.
      // Never await the blocked mover while this writer transaction is still open.
      await writerDb.transaction(async (writerTx) => {
        // Match service order. Both movers' pipeline SHARE locks remain compatible.
        await writerTx.execute(
          sql`SELECT id FROM ${pipelines} WHERE id = ${pipeline.id} FOR SHARE`,
        );
        await writerTx.execute(sql`SELECT id FROM ${deals} WHERE id = ${dealId} FOR UPDATE`);
        run.stale = moveDeal(
          moverDb,
          actor,
          {
            dealId,
            toStageId: first.id,
            beforePosition: "10",
            afterPosition: "20",
            expectedUpdatedAt,
            expectedWriteVersion: baseline.writeVersion,
          },
          AbortSignal.timeout(12_000),
        ).then(
          (value): MoveOutcome => ({ kind: "result", value }),
          (error: unknown): MoveOutcome => {
            failures.push(error);
            return { kind: "thrown", error };
          },
        );
        await waitForBlockedDealRowLock(observer, moverPid, writerPid);

        // Actual competing mutation. moveDeal(writerTx) uses a nested savepoint.
        const winner = await moveDeal(
          writerTx,
          actor,
          {
            dealId,
            toStageId: second.id,
            beforePosition: "30",
            afterPosition: "40",
            expectedUpdatedAt,
            expectedWriteVersion: baseline.writeVersion,
          },
          AbortSignal.timeout(8_000),
        );
        if (!winner.ok) throw winner.error;
        expect(winner.value.stageId).toBe(second.id);
        expect(winner.value.boardPosition).toBe("35");
        // Deliberately construct two distinct DB versions in one client-visible millisecond.
        // Only version precision is injected; stage/order/audit/event use the real winner path.
        await writerTx.execute(sql`
          UPDATE ${deals} SET updated_at = ${T1}::timestamptz WHERE id = ${dealId}
        `);
        const precision = await writer.query<{
          advanced: boolean;
          sameMillisecond: boolean;
          exactMicros: string;
        }>(
          `SELECT updated_at > $2::timestamptz AS advanced,
                  date_trunc('milliseconds', updated_at) = $2::timestamptz AS "sameMillisecond",
                  to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "exactMicros"
             FROM deals WHERE id = $1`,
          [dealId, T0],
        );
        expect(precision.rows).toEqual([
          { advanced: true, sameMillisecond: true, exactMicros: T1 },
        ]);
        run.winner = await snapshot(writer, dealId, channel);
      });
      // COMMIT has acknowledged and released the blocker before joining the stale request.
      const stale = run.stale;
      const winnerSnapshot = run.winner;
      if (stale === undefined || winnerSnapshot === undefined)
        throw new Error("fixture did not launch both moves");
      const outcome = await within(stale, 3_000, "stale move after winner commit");
      const after = await snapshot(observer, dealId, channel);
      expect({ outcome: resultSummary(outcome), persisted: after }).toEqual({
        outcome: { kind: "result", ok: false, errorId: ERROR_IDS.DEAL_PRECONDITION },
        persisted: winnerSnapshot,
      });
    } catch (error) {
      failures.push(error);
    } finally {
      // The writer's transaction already committed or rolled back above. Capture late failures
      // without an unhandled rejection, then retire all clients this test borrowed before close.
      try {
        if (run.stale !== undefined) await within(run.stale, 3_000, "mover cleanup");
      } catch (error) {
        failures.push(error);
      }
      for (const client of owned) {
        try {
          client.release(true);
        } catch (error) {
          failures.push(error);
        }
      }
      try {
        if (run.stale !== undefined) await within(run.stale, 2_000, "mover retirement");
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
    if (failures.length > 1) throw new AggregateError(failures, "stage race and cleanup failed");
  }, 25_000);
});
