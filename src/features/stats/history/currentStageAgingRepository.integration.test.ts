import { randomUUID } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import type { PoolClient } from "pg";
import { describe, expect, test } from "vitest";
import type { PermissionFlagKey } from "@/constants/permissionFlags";
import type { PermSetUser } from "@/features/permissions/effective";
import { makeTestDb, type TestDb } from "@/test/db";
import {
  beginHistoryTransaction,
  type HistoryCaptureFixture,
  insertHistoryDeal,
  prepareHistoryCapture,
  readCaptureEvents,
  readCaptureHead,
} from "./capture.test-helpers";
import {
  type CurrentStageAging,
  type CurrentStageAgingRequest,
  MAX_CURRENT_STAGE_AGING_DEALS,
  readCurrentStageAging,
  readCurrentStageAgingView,
} from "./currentStageAgingRepository";

type Available = Extract<CurrentStageAging, { state: "available" }>;
type SqlConnection = Pick<TestDb["pool"], "query">;

function actorFor(id: string): PermSetUser {
  return {
    id,
    type: "regular",
    isActive: true,
    flags: new Set<PermissionFlagKey>(),
    groupIds: new Set<string>(),
  };
}

async function withCapture(
  run: (h: TestDb, fixture: HistoryCaptureFixture, actor: PermSetUser) => Promise<void>,
) {
  const h = await makeTestDb();
  h.pool.options.statement_timeout = 5_000;
  h.pool.options.lock_timeout = 2_000;
  try {
    const fixture = await prepareHistoryCapture(h);
    await run(h, fixture, actorFor(fixture.userId));
  } finally {
    await h.close();
  }
}

async function withTransaction(h: TestDb, run: (client: PoolClient) => Promise<void>) {
  const client = await h.pool.connect();
  try {
    await beginHistoryTransaction(client);
    await run(client);
  } finally {
    try {
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  }
}

function read(
  h: TestDb,
  actor: PermSetUser,
  scope: CurrentStageAgingRequest = { currency: "EUR" },
) {
  return readCurrentStageAging(h.db, actor, scope, AbortSignal.timeout(10_000));
}

function requireAvailable(result: CurrentStageAging): asserts result is Available {
  expect(result.state).toBe("available");
  if (result.state !== "available") throw new Error(`Expected stage aging, got ${result.reason}`);
}

function group(result: Available, pipelineId: string, stageId: string) {
  const found = result.statistics.groups.find(
    (row) => row.pipelineId === pipelineId && row.stageId === stageId,
  );
  if (found === undefined) throw new Error("Expected stage statistics for fixture stage");
  return found;
}

function elapsed(from: string, to: string) {
  return (
    Temporal.Instant.from(to).epochNanoseconds - Temporal.Instant.from(from).epochNanoseconds
  ).toString();
}

async function capturedDealEvent(connection: SqlConnection, dealId: string, index: number) {
  const event = (await readCaptureEvents(connection, "deal", dealId)).at(index);
  if (event === undefined) throw new Error("Expected a captured deal event");
  return event;
}

async function addPipeline(h: TestDb) {
  const pipelineId = randomUUID();
  const stageId = randomUUID();
  await h.pool.query("INSERT INTO pipelines(id,name) VALUES($1,'Aging destination')", [pipelineId]);
  await h.pool.query(
    "INSERT INTO stages(id,pipeline_id,name) VALUES($1,$2,'Aging destination stage')",
    [stageId, pipelineId],
  );
  return { pipelineId, stageId };
}

describe("native current-authorized stage aging collector", () => {
  test("separates completed stays, known open ages and baseline lower bounds in one cohort", async () => {
    await withCapture(async (h, f, actor) => {
      const open = await insertHistoryDeal(h.pool, f, { title: "Private aging open title" });
      const closed = await insertHistoryDeal(h.pool, f, { title: "Private aging closed title" });
      await h.pool.query("UPDATE deals SET stage_id=$2 WHERE id=$1", [closed.id, f.otherStageId]);
      await h.pool.query("UPDATE deals SET status='won',won_time=clock_timestamp() WHERE id=$1", [
        closed.id,
      ]);
      await insertHistoryDeal(h.pool, f, { currency: "USD" });

      const result = await read(h, actor, { currency: "EUR", pipelineId: f.pipelineId });
      requireAvailable(result);
      expect(result).toMatchObject({
        currency: "EUR",
        historyBasis: "observed-stays-of-current-cohort-since-capture",
        population: {
          basis: "current-authorized-live-deals",
          dealCount: 3,
          currentOpenDealCount: 2,
        },
        statistics: { inputDealIncarnations: 3, episodeCount: 4 },
      });
      const cutoff = result.statistics.observationCutoff;
      const baseline = await capturedDealEvent(h.pool, f.dealId, 0);
      const opened = await capturedDealEvent(h.pool, open.id, 0);
      const entered = await capturedDealEvent(h.pool, closed.id, 0);
      const moved = await capturedDealEvent(h.pool, closed.id, 1);
      const won = await capturedDealEvent(h.pool, closed.id, 2);
      const first = group(result, f.pipelineId, f.stageId);
      const firstDuration = elapsed(entered.observedAt, moved.observedAt);
      const openAge = elapsed(opened.observedAt, cutoff);

      expect(first.completed).toMatchObject({
        sampleCount: 1,
        medianNanoseconds: firstDuration,
        p75Nanoseconds: firstDuration,
        p90Nanoseconds: firstDuration,
        contributors: [
          { entityId: closed.id, exitReason: "stage-change", durationNanoseconds: firstDuration },
        ],
      });
      expect(first.currentOpen).toMatchObject({
        sampleCount: 1,
        medianNanoseconds: openAge,
        contributors: [{ entityId: open.id, ageNanoseconds: openAge, observationCutoff: cutoff }],
      });
      expect(first.leftCensored.completed.sampleCount).toBe(0);
      expect(first.leftCensored.currentOpen).toMatchObject({
        sampleCount: 1,
        contributors: [
          {
            entityId: f.dealId,
            observedFrom: baseline.observedAt,
            observedTo: cutoff,
            lowerBoundNanoseconds: elapsed(baseline.observedAt, cutoff),
          },
        ],
      });
      const second = group(result, f.pipelineId, f.otherStageId);
      expect(second.completed).toMatchObject({
        sampleCount: 1,
        medianNanoseconds: elapsed(moved.observedAt, won.observedAt),
        contributors: [{ entityId: closed.id, exitReason: "won" }],
      });
      expect(second.currentOpen.sampleCount).toBe(0);
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain("Private aging");
      expect(serialized).not.toContain("do-not-copy-into-analytics");
      expect(serialized).not.toContain("observationSnapshot");
    });
  });

  test("withholds historical visits after a prior pipeline becomes restricted", async () => {
    await withCapture(async (h, f, actor) => {
      const destination = await addPipeline(h);
      await h.pool.query("UPDATE deals SET pipeline_id=$2,stage_id=$3 WHERE id=$1", [
        f.dealId,
        destination.pipelineId,
        destination.stageId,
      ]);
      const scope = { currency: "EUR", pipelineId: destination.pipelineId };
      const visible = await read(h, actor, scope);
      requireAvailable(visible);
      expect(visible.population.dealCount).toBe(1);
      expect(group(visible, f.pipelineId, f.stageId).leftCensored.completed.sampleCount).toBe(1);
      expect(
        group(visible, destination.pipelineId, destination.stageId).currentOpen.sampleCount,
      ).toBe(1);

      await h.pool.query("UPDATE pipelines SET name=$2 WHERE id=$1", [
        f.pipelineId,
        "Current origin pipeline label",
      ]);
      await h.pool.query("UPDATE stages SET name=$2 WHERE id=$1", [
        f.stageId,
        "Current origin stage label",
      ]);
      const readView = () =>
        readCurrentStageAgingView(h.db, actor, scope, AbortSignal.timeout(10_000));
      const view = await readView();
      expect(view.state).toBe("available");
      if (view.state !== "available") throw new Error("Expected current stage labels");
      expect(view.dealCount).toBe(1);
      expect(view.rows).toHaveLength(2);
      expect(
        view.rows.find(({ stageName }) => stageName === "Current origin stage label"),
      ).toMatchObject({
        pipelineName: "Current origin pipeline label",
        leftCensored: { completed: { sampleCount: 1 } },
      });

      const groupId = randomUUID();
      await h.pool.query("INSERT INTO visibility_groups(id,name) VALUES($1,$2)", [
        groupId,
        `Restricted aging ${groupId}`,
      ]);
      await h.pool.query("UPDATE pipelines SET visibility_group_id=$2 WHERE id=$1", [
        f.pipelineId,
        groupId,
      ]);
      const current = await h.pool.query<{ pipelineId: string; unrestricted: boolean }>(
        `
        SELECT d.pipeline_id::text AS "pipelineId",p.visibility_group_id IS NULL AS unrestricted
        FROM deals d JOIN pipelines p ON p.id=d.pipeline_id WHERE d.id=$1 AND d.owner_id=$2`,
        [f.dealId, actor.id],
      );
      expect(current.rows).toEqual([{ pipelineId: destination.pipelineId, unrestricted: true }]);
      expect(await read(h, actor, scope)).toEqual({
        state: "unavailable",
        reason: "history-permission-limited",
      });
      expect(await readView()).toEqual({ state: "unavailable", reason: "read" });
    });
  });

  test("withholds a private closed stay after an owner transfer in the same visible pipeline", async () => {
    await withCapture(async (h, f, actor) => {
      const previousOwner = randomUUID();
      await h.pool.query("INSERT INTO users (id,email,name) VALUES ($1,$2,'Prior aging owner')", [
        previousOwner,
        `${previousOwner}@example.test`,
      ]);
      const privateDeal = await insertHistoryDeal(h.pool, {
        ...f,
        userId: previousOwner,
        stageId: f.otherStageId,
      });
      await h.pool.query("UPDATE deals SET status='won',won_time=clock_timestamp() WHERE id=$1", [
        privateDeal.id,
      ]);

      const scope = {
        currency: "EUR",
        pipelineId: f.pipelineId,
        ownerScope: { kind: "me" },
      } as const;
      const before = await read(h, actor, scope);
      requireAvailable(before);
      expect(before.population.dealCount).toBe(1);
      expect(before.statistics.groups.map(({ stageId }) => stageId)).toEqual([f.stageId]);

      const transfer = await h.pool.query("UPDATE deals SET owner_id=$2 WHERE id=$1", [
        privateDeal.id,
        actor.id,
      ]);
      expect(transfer.rowCount).toBe(1);
      const event = await capturedDealEvent(h.pool, privateDeal.id, -1);
      expect(event.beforeState).toMatchObject({
        ownerId: previousOwner,
        pipelineId: f.pipelineId,
        visibilityLevel: "owner",
      });
      expect(event.afterState).toMatchObject({
        ownerId: actor.id,
        pipelineId: f.pipelineId,
        visibilityLevel: "owner",
      });
      expect(await read(h, actor, scope)).toEqual({
        state: "unavailable",
        reason: "history-permission-limited",
      });
      expect(
        await readCurrentStageAgingView(h.db, actor, scope, AbortSignal.timeout(10_000)),
      ).toEqual({ state: "unavailable", reason: "read" });
    });
  });

  test("withholds a retired stage visit even when a new stage reuses the UUID and parent", async () => {
    await withCapture(async (h, f, actor) => {
      const original = await readCaptureHead(h.pool, "stage", f.stageId);
      await h.pool.query("UPDATE deals SET stage_id=$2 WHERE id=$1", [f.dealId, f.otherStageId]);
      await h.pool.query("DELETE FROM stages WHERE id=$1", [f.stageId]);
      const denied = { state: "unavailable", reason: "stage-definition-unavailable" };
      expect(await read(h, actor)).toEqual(denied);
      await h.pool.query(
        "INSERT INTO stages(id,pipeline_id,name) VALUES($1,$2,'Replacement aging stage')",
        [f.stageId, f.pipelineId],
      );
      const replacement = await readCaptureHead(h.pool, "stage", f.stageId);
      expect(replacement.active).toBe(true);
      expect(replacement.incarnationId).not.toBe(original.incarnationId);
      expect(await read(h, actor)).toEqual(denied);
    });
  });

  test("does not qualify a historical stage that moved away and then returned to its parent", async () => {
    await withCapture(async (h, f, actor) => {
      await h.pool.query("UPDATE deals SET stage_id=$2 WHERE id=$1", [f.dealId, f.otherStageId]);
      const original = await readCaptureHead(h.pool, "stage", f.stageId);
      const destination = await addPipeline(h);
      await h.pool.query("UPDATE stages SET pipeline_id=$2 WHERE id=$1", [
        f.stageId,
        destination.pipelineId,
      ]);
      await h.pool.query("UPDATE stages SET pipeline_id=$2 WHERE id=$1", [f.stageId, f.pipelineId]);
      const stageEvents = await readCaptureEvents(h.pool, "stage", f.stageId);
      expect(stageEvents.map(({ afterState }) => afterState?.pipelineId)).toEqual([
        f.pipelineId,
        destination.pipelineId,
        f.pipelineId,
      ]);
      expect((await readCaptureHead(h.pool, "stage", f.stageId)).incarnationId).toBe(
        original.incarnationId,
      );
      expect(await read(h, actor)).toEqual({
        state: "unavailable",
        reason: "stage-definition-unavailable",
      });
    });
  });

  test("folds archive and restore within one transaction but withholds a committed inactive interval", async () => {
    await withCapture(async (h, f, actor) => {
      const archive = "UPDATE deals SET archived_at=clock_timestamp() WHERE id=$1";
      const restore = "UPDATE deals SET archived_at=NULL WHERE id=$1";
      await withTransaction(h, async (client) => {
        await client.query(archive, [f.dealId]);
        await client.query(restore, [f.dealId]);
        await client.query("COMMIT");
      });
      const archived = await capturedDealEvent(h.pool, f.dealId, 1);
      const restored = await capturedDealEvent(h.pool, f.dealId, 2);
      expect(archived.afterState?.archivedAt).toMatch(/\.\d{6}Z$/);
      expect(restored.afterState?.archivedAt).toBeNull();
      expect(restored.transactionId).toBe(archived.transactionId);
      const folded = await read(h, actor);
      requireAvailable(folded);
      expect(folded.population).toMatchObject({ dealCount: 1, currentOpenDealCount: 1 });
      expect(folded.statistics.episodeCount).toBe(1);
      expect(group(folded, f.pipelineId, f.stageId).leftCensored.currentOpen.sampleCount).toBe(1);

      await h.pool.query(archive, [f.dealId]);
      const absent = await read(h, actor);
      requireAvailable(absent);
      expect(absent.population.dealCount).toBe(0);
      await h.pool.query(restore, [f.dealId]);
      const laterArchive = await capturedDealEvent(h.pool, f.dealId, 3);
      const laterRestore = await capturedDealEvent(h.pool, f.dealId, 4);
      expect(laterRestore.transactionId).not.toBe(laterArchive.transactionId);
      expect(await read(h, actor)).toEqual({
        state: "unavailable",
        reason: "aging-evidence-unavailable",
        detail: "archived-state-in-history",
      });
    });
  });

  test("excludes a lower-ordinal uncommitted move until a fresh native snapshot sees it", async () => {
    await withCapture(async (h, f, actor) => {
      await withTransaction(h, async (client) => {
        await client.query("UPDATE deals SET stage_id=$2 WHERE id=$1", [f.dealId, f.otherStageId]);
        const pending = await capturedDealEvent(client, f.dealId, -1);
        expect(pending.afterState?.stageId).toBe(f.otherStageId);
        const peer = await insertHistoryDeal(h.pool, f);
        const peerInsert = await capturedDealEvent(h.pool, peer.id, 0);
        expect(BigInt(pending.ordinal) < BigInt(peerInsert.ordinal)).toBe(true);

        const before = await read(h, actor);
        requireAvailable(before);
        expect(before.population).toMatchObject({ dealCount: 2, currentOpenDealCount: 2 });
        expect(before.statistics.groups.map(({ stageId }) => stageId)).toEqual([f.stageId]);
        const first = group(before, f.pipelineId, f.stageId);
        expect(first.leftCensored.currentOpen.contributors.map(({ entityId }) => entityId)).toEqual(
          [f.dealId],
        );
        expect(first.currentOpen.contributors.map(({ entityId }) => entityId)).toEqual([peer.id]);

        await client.query("COMMIT");
        const after = await read(h, actor);
        requireAvailable(after);
        expect(after.population).toEqual(before.population);
        expect(group(after, f.pipelineId, f.stageId).leftCensored.completed.sampleCount).toBe(1);
        expect(group(after, f.pipelineId, f.otherStageId).currentOpen.contributors).toMatchObject([
          {
            entityId: f.dealId,
            enteredAt: pending.observedAt,
            ageNanoseconds: elapsed(pending.observedAt, after.statistics.observationCutoff),
          },
        ]);
      });
    });
  });

  test("refuses cap-plus-one scoped deals instead of returning truncated stage statistics", async () => {
    await withCapture(async (h, f, actor) => {
      await withTransaction(h, async (client) => {
        await client.query("SET LOCAL statement_timeout='20000ms'");
        await client.query(
          `INSERT INTO deals(title,pipeline_id,stage_id,owner_id,visibility_level,currency)
           SELECT 'Aging bound', $1::uuid,$2::uuid,$3::uuid,'owner'::public.visibility_level,'EUR'
           FROM generate_series(1,$4::integer)`,
          [f.pipelineId, f.stageId, actor.id, MAX_CURRENT_STAGE_AGING_DEALS],
        );
        await client.query("COMMIT");
      });
      expect(await read(h, actor)).toEqual({ state: "unavailable", reason: "scope-limit" });
    });
  });
});
