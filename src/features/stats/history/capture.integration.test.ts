import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { describe, expect, test } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import {
  beginHistoryTransaction,
  EXACT_LEGACY_VALUE,
  type HistoryCaptureFixture,
  historyMigrationReceipts,
  historySourceRows,
  insertHistoryDeal,
  LEGACY_CREATED_AT,
  LEGACY_STAGE_ENTERED_AT,
  prepareHistoryCapture,
  readCaptureEvents,
  readCaptureHead,
} from "./capture.test-helpers";
import type { AnalyticsHistoryEvent } from "./contracts";
import { foldTransactionHistory } from "./fold";

// Source definitions only until a qualified native run is recorded. Each test applies
// the unnumbered proposal to its own migrated database clone, never the canonical journal.
async function withCapture(
  work: (h: TestDb, fixture: HistoryCaptureFixture) => Promise<void>,
): Promise<void> {
  const h = await makeTestDb();
  // This pool belongs only to the disposable clone and has opened no source connection yet.
  h.pool.options.statement_timeout = 5_000;
  h.pool.options.lock_timeout = 2_000;
  try {
    await work(h, await prepareHistoryCapture(h));
  } finally {
    await h.close();
  }
}

function eventAt(events: AnalyticsHistoryEvent[], index: number): AnalyticsHistoryEvent {
  const event = events[index];
  if (event === undefined) throw new Error(`Expected captured event ${index}`);
  return event;
}

async function releaseTransaction(client: PoolClient | undefined): Promise<void> {
  if (client === undefined) return;
  try {
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
}

async function releaseTransactions(...clients: (PoolClient | undefined)[]): Promise<void> {
  const results = await Promise.allSettled(clients.map(releaseTransaction));
  const failures: unknown[] = [];
  for (const result of results) {
    if (result.status === "rejected") failures.push(result.reason);
  }
  if (failures.length !== 0)
    throw new AggregateError(failures, "History transaction cleanup failed");
}

describe("private analytics row-capture proposal on real PostgreSQL", () => {
  test("observes populated legacy rows at activation without inventing creation or changing source rows", async () => {
    await withCapture(async (h, f) => {
      expect(await historySourceRows(h.pool)).toEqual(f.beforeSources);
      expect(await historyMigrationReceipts(h.pool)).toEqual(f.beforeReceipts);
      const events = await readCaptureEvents(h.pool);
      const coverage = await h.pool.query<{
        activationId: string;
        activatedAt: string;
        transactionId: string;
        snapshot: string;
        deals: string;
        stages: string;
        pipelines: string;
      }>(`SELECT activation_id::text AS "activationId",
          to_char(activated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "activatedAt",
          activation_transaction_id AS "transactionId", baseline_snapshot::text AS snapshot,
          baseline_deal_count::text AS deals, baseline_stage_count::text AS stages,
          baseline_pipeline_count::text AS pipelines FROM analytics_history_coverage WHERE id`);
      const activation = coverage.rows[0];
      if (activation === undefined) throw new Error("Missing history activation");
      expect(events).toHaveLength(f.beforeSources.length);
      expect(new Set(events.map((event) => event.eventId)).size).toBe(events.length);
      expect(events.every((event) => event.eventKind === "baseline")).toBe(true);
      for (const event of events) {
        expect(event.activationId).toBe(activation.activationId);
        expect(event.observedAt).toBe(activation.activatedAt);
        expect(event.transactionId).toBe(activation.transactionId);
        expect(event.observationSnapshot).toBe(activation.snapshot);
        expect(event.beforeState).toBeNull();
      }
      expect(activation.deals).toBe(
        String(events.filter((event) => event.entityKind === "deal").length),
      );
      expect(activation.stages).toBe(
        String(events.filter((event) => event.entityKind === "stage").length),
      );
      expect(activation.pipelines).toBe(
        String(events.filter((event) => event.entityKind === "pipeline").length),
      );
      const legacy = eventAt(await readCaptureEvents(h.pool, "deal", f.dealId), 0);
      expect(legacy.afterState?.createdAt).toBe(LEGACY_CREATED_AT);
      expect(legacy.observedAt).not.toBe(LEGACY_CREATED_AT);
      expect(await readCaptureHead(h.pool, "deal", f.dealId)).toMatchObject({
        active: true,
        incarnationId: legacy.incarnationId,
        lastEventOrdinal: legacy.ordinal,
      });
    });
  });

  test("retains exact decimal money, microseconds and opaque tokens while actor and command remain unknown", async () => {
    await withCapture(async (h, f) => {
      const baseline = eventAt(await readCaptureEvents(h.pool, "deal", f.dealId), 0);
      const source = await h.pool.query<{ version: string }>(
        "SELECT write_version::text AS version FROM deals WHERE id=$1",
        [f.dealId],
      );
      expect(baseline.afterState).toMatchObject({
        value: EXACT_LEGACY_VALUE,
        currency: "EUR",
        createdAt: LEGACY_CREATED_AT,
        stageEnteredAt: LEGACY_STAGE_ENTERED_AT,
        ownerId: f.userId,
        stageId: f.stageId,
        pipelineId: f.pipelineId,
      });
      expect(baseline.afterState).not.toHaveProperty("customFields");
      expect(baseline.afterState).not.toHaveProperty("custom_fields");
      expect(baseline.afterState).not.toHaveProperty("boardPosition");
      expect(JSON.stringify(baseline.afterState)).not.toContain("do-not-copy-into-analytics");
      expect(baseline.beforeWriteVersion).toBeNull();
      expect(baseline.afterWriteVersion).toBe(source.rows[0]?.version);
      expect(baseline.afterWriteVersion).toMatch(/^[0-9a-f-]{36}$/);
      expect(baseline.actorId).toBeNull();
      expect(baseline.commandId).toBeNull();
      expect(baseline.transactionId).toMatch(/^[1-9]\d*$/);
      expect(baseline.observationSnapshot).toMatch(/^\d+:\d+:(?:\d+(?:,\d+)*)?$/);
      expect(baseline.observedAt).toMatch(/\.\d{6}Z$/);
    });
  });

  test("captures raw SQL insertion and an exact stage transition with before and after revision pairs", async () => {
    await withCapture(async (h, f) => {
      const inserted = await insertHistoryDeal(h.pool, f, { value: "0.0001" });
      await h.pool.query(
        "UPDATE deals SET stage_id=$2,stage_entered_at='2030-01-02T03:04:05.000001Z' WHERE id=$1",
        [inserted.id, f.otherStageId],
      );
      const events = await readCaptureEvents(h.pool, "deal", inserted.id);
      expect(events.map((event) => event.eventKind)).toEqual(["insert", "update"]);
      const first = eventAt(events, 0);
      const second = eventAt(events, 1);
      expect(first.beforeState).toBeNull();
      expect(first.afterState?.stageId).toBe(f.stageId);
      expect(first.afterWriteVersion).toBe(inserted.writeVersion);
      expect(second.beforeState).toEqual(first.afterState);
      expect(second.beforeWriteVersion).toBe(first.afterWriteVersion);
      expect(second.afterWriteVersion).not.toBe(first.afterWriteVersion);
      expect(second.afterState).toMatchObject({
        stageId: f.otherStageId,
        stageEnteredAt: "2030-01-02T03:04:05.000001Z",
        value: "0.0001",
      });
      expect(second.incarnationId).toBe(first.incarnationId);
    });
  });

  test("preserves raw won, lost and reopening observations instead of erasing earlier outcomes", async () => {
    await withCapture(async (h, f) => {
      await h.pool.query(
        "UPDATE deals SET status='won',won_time='2030-06-01T12:00:00.123456Z' WHERE id=$1",
        [f.dealId],
      );
      await h.pool.query(
        "UPDATE deals SET status='lost',won_time=NULL,lost_time='2030-06-02T12:00:00.654321Z',lost_reason='No decision' WHERE id=$1",
        [f.dealId],
      );
      await h.pool.query(
        "UPDATE deals SET status='open',won_time=NULL,lost_time=NULL WHERE id=$1",
        [f.dealId],
      );
      const events = await readCaptureEvents(h.pool, "deal", f.dealId);
      expect(events.map((event) => event.afterState?.status)).toEqual([
        "open",
        "won",
        "lost",
        "open",
      ]);
      expect(eventAt(events, 2).beforeState?.wonTime).toBe("2030-06-01T12:00:00.123456Z");
      expect(eventAt(events, 2).afterState).toMatchObject({
        lostTime: "2030-06-02T12:00:00.654321Z",
        wonTime: null,
        lostReason: "No decision",
      });
      expect(eventAt(events, 3).beforeState?.lostTime).toBe("2030-06-02T12:00:00.654321Z");
      expect(eventAt(events, 3).afterState).toMatchObject({ wonTime: null, lostTime: null });
    });
  });

  test("keeps original currencies and exact value corrections including missing value", async () => {
    await withCapture(async (h, f) => {
      await h.pool.query("UPDATE deals SET value='0.0001',currency='IRR' WHERE id=$1", [f.dealId]);
      await h.pool.query("UPDATE deals SET value=NULL WHERE id=$1", [f.dealId]);
      const events = await readCaptureEvents(h.pool, "deal", f.dealId);
      expect(eventAt(events, 1).beforeState).toMatchObject({
        value: EXACT_LEGACY_VALUE,
        currency: "EUR",
      });
      expect(eventAt(events, 1).afterState).toMatchObject({ value: "0.0001", currency: "IRR" });
      expect(eventAt(events, 2).afterState).toMatchObject({ value: null, currency: "IRR" });
    });
  });

  test("captures archival and soft removal without confusing business state with physical incarnation", async () => {
    await withCapture(async (h, f) => {
      await h.pool.query("UPDATE deals SET archived_at='2030-06-01T00:00:00.000001Z' WHERE id=$1", [
        f.dealId,
      ]);
      await h.pool.query("UPDATE deals SET deleted_at='2030-06-02T00:00:00.000002Z' WHERE id=$1", [
        f.dealId,
      ]);
      const events = await readCaptureEvents(h.pool, "deal", f.dealId);
      expect(events.map((event) => event.eventKind)).toEqual(["baseline", "update", "update"]);
      expect(eventAt(events, 1).afterState?.archivedAt).toBe("2030-06-01T00:00:00.000001Z");
      expect(eventAt(events, 2).afterState?.deletedAt).toBe("2030-06-02T00:00:00.000002Z");
      expect(await readCaptureHead(h.pool, "deal", f.dealId)).toMatchObject({ active: true });
    });
  });

  test("suppresses board ordering, update-clock and revision-only writes without losing the next material token", async () => {
    await withCapture(async (h, f) => {
      const before = await readCaptureEvents(h.pool, "deal", f.dealId);
      const head = await readCaptureHead(h.pool, "deal", f.dealId);
      const ignored = await h.pool.query<{ version: string }>(
        `UPDATE deals SET board_position=board_position+1,updated_at=clock_timestamp(),write_version=gen_random_uuid()
         WHERE id=$1 RETURNING write_version::text AS version`,
        [f.dealId],
      );
      expect(await readCaptureEvents(h.pool, "deal", f.dealId)).toEqual(before);
      expect(await readCaptureHead(h.pool, "deal", f.dealId)).toEqual(head);
      expect(ignored.rows[0]?.version).not.toBe(head.lastWriteVersion);
      await h.pool.query("UPDATE deals SET title='Material edit after ignored write' WHERE id=$1", [
        f.dealId,
      ]);
      const updated = eventAt(await readCaptureEvents(h.pool, "deal", f.dealId), 1);
      expect(updated.beforeWriteVersion).toBe(ignored.rows[0]?.version);
      expect(updated.beforeState).toEqual(eventAt(before, 0).afterState);
      expect(updated.afterState?.title).toBe("Material edit after ignored write");
    });
  });

  test("rolls source rows, events and heads back with their whole transaction", async () => {
    await withCapture(async (h, f) => {
      const before = await readCaptureEvents(h.pool);
      const head = await readCaptureHead(h.pool, "deal", f.dealId);
      let client: PoolClient | undefined;
      try {
        client = await h.pool.connect();
        await beginHistoryTransaction(client);
        await client.query("UPDATE deals SET title='Must roll back',stage_id=$2 WHERE id=$1", [
          f.dealId,
          f.otherStageId,
        ]);
        expect(await readCaptureEvents(client)).toHaveLength(before.length + 1);
        await client.query("ROLLBACK");
        expect(await historySourceRows(h.pool)).toEqual(f.beforeSources);
        expect(await readCaptureEvents(h.pool)).toEqual(before);
        expect(await readCaptureHead(h.pool, "deal", f.dealId)).toEqual(head);
      } finally {
        await releaseTransaction(client);
      }
    });
  });

  test("removes rolled-back savepoint events while committing the retained transaction observation", async () => {
    await withCapture(async (h, f) => {
      let client: PoolClient | undefined;
      try {
        client = await h.pool.connect();
        await beginHistoryTransaction(client);
        await client.query("UPDATE deals SET title='Retained outer edit' WHERE id=$1", [f.dealId]);
        await client.query("SAVEPOINT abandoned_currency");
        await client.query("UPDATE deals SET currency='USD' WHERE id=$1", [f.dealId]);
        expect(await readCaptureEvents(client, "deal", f.dealId)).toHaveLength(3);
        await client.query(
          "ROLLBACK TO SAVEPOINT abandoned_currency; RELEASE SAVEPOINT abandoned_currency; COMMIT",
        );
        const events = await readCaptureEvents(h.pool, "deal", f.dealId);
        expect(events).toHaveLength(2);
        expect(eventAt(events, 1).afterState).toMatchObject({
          title: "Retained outer edit",
          currency: "EUR",
        });
        expect(await readCaptureHead(h.pool, "deal", f.dealId)).toMatchObject({
          lastEventOrdinal: eventAt(events, 1).ordinal,
          lastWriteVersion: eventAt(events, 1).afterWriteVersion,
        });
      } finally {
        await releaseTransaction(client);
      }
    });
  });

  test("rejects in-place source primary-key mutation and leaves source and capture unchanged", async () => {
    await withCapture(async (h, f) => {
      const before = await readCaptureEvents(h.pool);
      await expect(
        h.pool.query("UPDATE deals SET id=$2 WHERE id=$1", [f.dealId, randomUUID()]),
      ).rejects.toMatchObject({ code: "55000" });
      expect(await historySourceRows(h.pool)).toEqual(f.beforeSources);
      expect(await readCaptureEvents(h.pool)).toEqual(before);
      const pipelineId = randomUUID();
      await h.pool.query("INSERT INTO pipelines (id,name) VALUES ($1,'Identity guard pipeline')", [
        pipelineId,
      ]);
      const beforePipeline = await readCaptureEvents(h.pool);
      await expect(
        h.pool.query("UPDATE pipelines SET id=$2 WHERE id=$1", [pipelineId, randomUUID()]),
      ).rejects.toMatchObject({ code: "55000" });
      expect(await readCaptureEvents(h.pool)).toEqual(beforePipeline);
      const stageId = randomUUID();
      await h.pool.query(
        "INSERT INTO stages (id,pipeline_id,name) VALUES ($1,$2,'Identity guard stage')",
        [stageId, pipelineId],
      );
      const beforeStage = await readCaptureEvents(h.pool);
      const sourceBeforeStage = await historySourceRows(h.pool);
      await expect(
        h.pool.query("UPDATE stages SET id=$2 WHERE id=$1", [stageId, randomUUID()]),
      ).rejects.toMatchObject({ code: "55000" });
      expect(await readCaptureEvents(h.pool)).toEqual(beforeStage);
      expect(await historySourceRows(h.pool)).toEqual(sourceBeforeStage);
    });
  });

  test("rejects source TRUNCATE including cascading source paths before any rows disappear", async () => {
    await withCapture(async (h, f) => {
      const before = await readCaptureEvents(h.pool);
      for (const table of ["deals", "stages", "pipelines"]) {
        await expect(h.pool.query(`TRUNCATE TABLE public.${table} CASCADE`)).rejects.toMatchObject({
          code: "55000",
        });
        expect(await historySourceRows(h.pool)).toEqual(f.beforeSources);
        expect(await readCaptureEvents(h.pool)).toEqual(before);
      }
      await h.pool.query("DELETE FROM deals; DELETE FROM stages; DELETE FROM pipelines");
      expect(await historySourceRows(h.pool)).toEqual([]);
      const retained = await readCaptureEvents(h.pool);
      for (const table of ["deals", "stages", "pipelines"]) {
        await expect(h.pool.query(`TRUNCATE TABLE public.${table} CASCADE`)).rejects.toMatchObject({
          code: "55000",
        });
      }
      expect(await historySourceRows(h.pool)).toEqual([]);
      expect(await readCaptureEvents(h.pool)).toEqual(retained);
    });
  });

  test("rejects event UPDATE, DELETE, TRUNCATE and direct fabricated INSERT", async () => {
    await withCapture(async (h) => {
      const before = await readCaptureEvents(h.pool);
      const mutations = [
        "UPDATE analytics_history_events SET actor_id=gen_random_uuid()",
        "DELETE FROM analytics_history_events",
        "TRUNCATE TABLE analytics_history_events",
        `INSERT INTO analytics_history_events (
          activation_id,entity_kind,entity_id,incarnation_id,event_kind,transaction_id,
          observed_at,observation_snapshot,after_state,after_write_version
         ) SELECT activation_id,entity_kind,entity_id,gen_random_uuid(),'baseline',transaction_id,
           clock_timestamp(),pg_current_snapshot(),after_state,after_write_version
         FROM analytics_history_events WHERE after_state IS NOT NULL LIMIT 1`,
      ];
      for (const mutation of mutations) {
        await expect(h.pool.query(mutation)).rejects.toMatchObject({ code: "55000" });
      }
      expect(await readCaptureEvents(h.pool)).toEqual(before);
    });
  });

  test("rejects direct head and coverage edits and invoking the capture trigger as a normal helper", async () => {
    await withCapture(async (h, f) => {
      const events = await readCaptureEvents(h.pool);
      const head = await readCaptureHead(h.pool, "deal", f.dealId);
      const mutations = [
        "UPDATE analytics_history_heads SET active=false",
        "DELETE FROM analytics_history_heads",
        "TRUNCATE TABLE analytics_history_heads",
        `INSERT INTO analytics_history_heads (
          entity_kind,entity_id,activation_id,incarnation_id,active,last_event_ordinal,
          last_write_version,incarnation_started_at,last_observed_at
         ) SELECT entity_kind,gen_random_uuid(),activation_id,gen_random_uuid(),active,last_event_ordinal,
           last_write_version,incarnation_started_at,last_observed_at FROM analytics_history_heads LIMIT 1`,
        "UPDATE analytics_history_coverage SET capture_semantics=capture_semantics",
        "DELETE FROM analytics_history_coverage",
        "TRUNCATE TABLE analytics_history_coverage CASCADE",
      ];
      for (const mutation of mutations) {
        await expect(h.pool.query(mutation)).rejects.toMatchObject({ code: "55000" });
      }
      await expect(h.pool.query("SELECT analytics_capture_row_change()")).rejects.toThrow(
        "trigger functions can only be called as triggers",
      );
      expect(await readCaptureEvents(h.pool)).toEqual(events);
      expect(await readCaptureHead(h.pool, "deal", f.dealId)).toEqual(head);
    });
  });

  test("starts a new physical incarnation when a hard-deleted UUID is inserted again", async () => {
    await withCapture(async (h, f) => {
      const baseline = eventAt(await readCaptureEvents(h.pool, "deal", f.dealId), 0);
      await h.pool.query("DELETE FROM deals WHERE id=$1", [f.dealId]);
      expect(await readCaptureHead(h.pool, "deal", f.dealId)).toMatchObject({
        incarnationId: baseline.incarnationId,
        active: false,
        lastWriteVersion: null,
      });
      await insertHistoryDeal(h.pool, f, {
        id: f.dealId,
        title: "Distinct reinserted source record",
        createdAt: "2031-02-03T04:05:06.000007Z",
      });
      const events = await readCaptureEvents(h.pool, "deal", f.dealId);
      expect(events.map((event) => event.eventKind)).toEqual(["baseline", "delete", "insert"]);
      expect(eventAt(events, 1).incarnationId).toBe(baseline.incarnationId);
      expect(eventAt(events, 1).beforeState).toEqual(baseline.afterState);
      expect(eventAt(events, 1).afterState).toBeNull();
      expect(eventAt(events, 2).incarnationId).not.toBe(baseline.incarnationId);
      expect(eventAt(events, 2).beforeState).toBeNull();
      expect(await readCaptureHead(h.pool, "deal", f.dealId)).toMatchObject({
        incarnationId: eventAt(events, 2).incarnationId,
        active: true,
        lastEventOrdinal: eventAt(events, 2).ordinal,
      });
    });
  });

  test("retains definition versions and folds successive rename and reorder observations in one transaction", async () => {
    await withCapture(async (h, f) => {
      const original = eventAt(await readCaptureEvents(h.pool, "stage", f.stageId), 0);
      let client: PoolClient | undefined;
      try {
        client = await h.pool.connect();
        await beginHistoryTransaction(client);
        await client.query("UPDATE stages SET name='Renamed qualification' WHERE id=$1", [
          f.stageId,
        ]);
        await client.query('UPDATE stages SET "order"=9,rotting_days=30 WHERE id=$1', [f.stageId]);
        await client.query(
          "UPDATE pipelines SET name='Reordered pipeline',\"order\"=4 WHERE id=$1",
          [f.pipelineId],
        );
        await client.query("COMMIT");
        const stages = await readCaptureEvents(h.pool, "stage", f.stageId);
        expect(eventAt(stages, 0)).toEqual(original);
        expect(eventAt(stages, 1).afterState).toMatchObject({
          name: "Renamed qualification",
          order: 0,
        });
        expect(eventAt(stages, 2).afterState).toMatchObject({
          name: "Renamed qualification",
          order: 9,
          rottingDays: 30,
        });
        const updates = stages.filter((event) => event.eventKind === "update");
        expect(new Set(updates.map((event) => event.transactionId)).size).toBe(1);
        const folded = foldTransactionHistory(updates);
        expect(folded.ok).toBe(true);
        if (!folded.ok) throw new Error("Captured definition chain did not fold");
        expect(folded.changes).toHaveLength(1);
        expect(folded.changes[0]).toMatchObject({
          beforeState: original.afterState,
          afterState: eventAt(stages, 2).afterState,
          eventIds: updates.map((event) => event.eventId),
          evidence: "observed-row-change",
        });
        expect(await readCaptureEvents(h.pool, "deal", f.dealId)).toHaveLength(1);
      } finally {
        await releaseTransaction(client);
      }
    });
  });

  test("captures nested stage deletions from a pipeline foreign-key cascade", async () => {
    await withCapture(async (h) => {
      const pipelineId = randomUUID();
      const stages = [randomUUID(), randomUUID()];
      await h.pool.query(
        "INSERT INTO pipelines (id,name) VALUES ($1,'Disposable cascade pipeline')",
        [pipelineId],
      );
      await h.pool.query(
        "INSERT INTO stages (id,pipeline_id,name,\"order\") VALUES ($1,$3,'A',0),($2,$3,'B',1)",
        [stages[0], stages[1], pipelineId],
      );
      await h.pool.query("DELETE FROM pipelines WHERE id=$1", [pipelineId]);
      const pipeline = await readCaptureEvents(h.pool, "pipeline", pipelineId);
      const stageEvents = await Promise.all(
        stages.map((id) => readCaptureEvents(h.pool, "stage", id)),
      );
      const deletions = [eventAt(pipeline, 1), ...stageEvents.map((events) => eventAt(events, 1))];
      expect(deletions.map((event) => event.eventKind)).toEqual(["delete", "delete", "delete"]);
      expect(new Set(deletions.map((event) => event.transactionId)).size).toBe(1);
      for (const deletion of deletions) {
        expect(deletion.beforeState).not.toBeNull();
        expect(deletion.afterState).toBeNull();
        expect(await readCaptureHead(h.pool, deletion.entityKind, deletion.entityId)).toMatchObject(
          { active: false },
        );
      }
    });
  });

  test("uses saved MVCC visibility to exclude a lower-ordinal transaction that commits after the reader cutoff", async () => {
    await withCapture(async (h, f) => {
      let a: PoolClient | undefined;
      let b: PoolClient | undefined;
      let reader: PoolClient | undefined;
      try {
        a = await h.pool.connect();
        b = await h.pool.connect();
        reader = await h.pool.connect();
        await beginHistoryTransaction(a);
        const first = await insertHistoryDeal(a, f, { title: "A remains uncommitted" });
        const eventA = eventAt(await readCaptureEvents(a, "deal", first.id), 0);
        await beginHistoryTransaction(b);
        const second = await insertHistoryDeal(b, f, { title: "B commits before cutoff" });
        const eventB = eventAt(await readCaptureEvents(b, "deal", second.id), 0);
        await b.query("COMMIT");
        const cut = await reader.query<{ snapshot: string; maximum: string }>(
          "SELECT pg_current_snapshot()::text AS snapshot,max(ordinal)::text AS maximum FROM analytics_history_events",
        );
        const saved = cut.rows[0];
        if (saved === undefined) throw new Error("Missing saved reader snapshot");
        expect(BigInt(eventA.ordinal) < BigInt(eventB.ordinal)).toBe(true);
        expect(saved.maximum).toBe(eventB.ordinal);
        const before = await reader.query<{ a: boolean; b: boolean }>(
          "SELECT pg_visible_in_snapshot($1::xid8,$3::pg_snapshot) AS a,pg_visible_in_snapshot($2::xid8,$3::pg_snapshot) AS b",
          [eventA.transactionId, eventB.transactionId, saved.snapshot],
        );
        expect(before.rows).toEqual([{ a: false, b: true }]);
        await a.query("COMMIT");
        const after = await reader.query<{ a: boolean; b: boolean }>(
          "SELECT pg_visible_in_snapshot($1::xid8,$3::pg_snapshot) AS a,pg_visible_in_snapshot($2::xid8,$3::pg_snapshot) AS b",
          [eventA.transactionId, eventB.transactionId, saved.snapshot],
        );
        expect(after.rows).toEqual([{ a: false, b: true }]);
        const membership = await reader.query<{ id: string; visible: boolean }>(
          `SELECT event_id::text AS id,pg_visible_in_snapshot(transaction_id::xid8,$2::pg_snapshot) AS visible
           FROM analytics_history_events WHERE ordinal <= $1::bigint AND event_id IN ($3::uuid,$4::uuid) ORDER BY ordinal`,
          [saved.maximum, saved.snapshot, eventA.eventId, eventB.eventId],
        );
        // A naive ordinal-only cutoff now includes both rows. The preserved snapshot still
        // admits only B, independently of current commit state or the event observation clock.
        expect(membership.rows).toEqual([
          { id: eventA.eventId, visible: false },
          { id: eventB.eventId, visible: true },
        ]);
      } finally {
        await releaseTransactions(a, b, reader);
      }
    });
  });

  test("records that a concurrently inserted deal did not observe an earlier-ordinal uncommitted stage rename", async () => {
    await withCapture(async (h, f) => {
      let a: PoolClient | undefined;
      let b: PoolClient | undefined;
      try {
        a = await h.pool.connect();
        b = await h.pool.connect();
        await beginHistoryTransaction(a);
        await a.query("UPDATE stages SET name='Uncommitted definition' WHERE id=$1", [f.stageId]);
        const stage = eventAt(await readCaptureEvents(a, "stage", f.stageId), 1);
        await beginHistoryTransaction(b);
        const seen = await b.query<{ name: string }>("SELECT name FROM stages WHERE id=$1", [
          f.stageId,
        ]);
        expect(seen.rows).toEqual([{ name: "Legacy qualification" }]);
        // A non-key rename takes NO KEY UPDATE. The FK's KEY SHARE remains compatible,
        // so this raw insertion must complete before A commits, under finite lock timeout.
        const inserted = await insertHistoryDeal(b, f, { title: "Deal sees committed definition" });
        const deal = eventAt(await readCaptureEvents(b, "deal", inserted.id), 0);
        await b.query("COMMIT");
        await a.query("COMMIT");
        expect(BigInt(stage.ordinal) < BigInt(deal.ordinal)).toBe(true);
        const visibility = await h.pool.query<{ visible: boolean }>(
          "SELECT pg_visible_in_snapshot($1::xid8,$2::pg_snapshot) AS visible",
          [stage.transactionId, deal.observationSnapshot],
        );
        expect(visibility.rows).toEqual([{ visible: false }]);
        expect(
          eventAt(await readCaptureEvents(h.pool, "stage", f.stageId), 1).afterState?.name,
        ).toBe("Uncommitted definition");
      } finally {
        await releaseTransactions(a, b);
      }
    });
  });
});
