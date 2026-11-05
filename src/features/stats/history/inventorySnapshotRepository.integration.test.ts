import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import { describe, expect, test } from "vitest";
import type { PermissionFlagKey } from "@/constants/permissionFlags";
import * as schema from "@/db/schema";
import { setPreferences } from "@/features/identity/preferencesRepo";
import type { PermSetUser } from "@/features/permissions/effective";
import { makeTestDb, type TestDb } from "@/test/db";
import {
  beginHistoryTransaction,
  EXACT_LEGACY_VALUE,
  type HistoryCaptureFixture,
  insertHistoryDeal,
  prepareHistoryCapture,
  readCaptureEvents,
  readCaptureHead,
} from "./capture.test-helpers";
import {
  type InventorySnapshotRequest,
  type InventorySnapshotWrite,
  MAX_INVENTORY_SNAPSHOT_FACTS,
  writeCurrentInventorySnapshot,
} from "./inventorySnapshotRepository";

const signal = () => AbortSignal.timeout(10_000);

function actorFor(id: string, flags: PermissionFlagKey[] = []): PermSetUser {
  return {
    id,
    type: "regular",
    isActive: true,
    groupIds: new Set<string>(),
    flags: new Set(flags),
  };
}

async function addUser(h: TestDb) {
  const id = randomUUID();
  await h.pool.query("INSERT INTO users(id,email,name) VALUES($1,$2,'Snapshot actor')", [
    id,
    `inventory-${id}@example.test`,
  ]);
  return id;
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

type Receipt = Extract<InventorySnapshotWrite, { state: "created" }>;

function requireCreated(result: InventorySnapshotWrite): asserts result is Receipt {
  expect(result.state).toBe("created");
  if (result.state !== "created")
    throw new Error(`Expected a snapshot receipt, got ${result.reason}`);
}

function write(
  h: TestDb,
  actor: PermSetUser,
  input: InventorySnapshotRequest = { currency: "EUR" },
) {
  return writeCurrentInventorySnapshot(h.db, actor, input, signal());
}

interface StoredSnapshot {
  activationId: string;
  kind: string;
  definitionVersion: number;
  reportDefinition: Record<string, unknown>;
  scope: Record<string, unknown>;
  currency: string;
  timeZone: string;
  calendar: string;
  observedAt: string;
  snapshot: string;
  highWater: string | null;
  targetFrom: string | null;
  targetToExclusive: string | null;
  modelVersion: string | null;
  modelDefinition: Record<string, unknown> | null;
  records: Record<string, unknown>[];
  createdBy: string;
}

// Test-only inspection of the private stored row. No production read contract is implied.
async function stored(h: TestDb, receipt: Receipt): Promise<StoredSnapshot> {
  const { rows } = await h.pool.query<StoredSnapshot>(
    `
    SELECT activation_id::text AS "activationId", kind, definition_version AS "definitionVersion",
      report_definition AS "reportDefinition", scope, currency, time_zone AS "timeZone", calendar,
      public.analytics_history_utc(cutoff_observed_at) AS "observedAt",
      transaction_snapshot::text AS snapshot, event_high_water_ordinal::text AS "highWater",
      target_from::text AS "targetFrom", target_to_exclusive::text AS "targetToExclusive",
      model_version AS "modelVersion", model_definition AS "modelDefinition", records,
      created_by::text AS "createdBy"
    FROM public.analytics_report_snapshots WHERE id=$1`,
    [receipt.snapshotId],
  );
  const row = rows[0];
  if (row === undefined) throw new Error("Expected one stored snapshot");
  return row;
}

async function snapshotCount(h: TestDb) {
  const { rows } = await h.pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM public.analytics_report_snapshots",
  );
  return rows[0]?.count;
}

async function restrictAnotherPipeline(h: TestDb, f: HistoryCaptureFixture) {
  const groupId = randomUUID();
  const pipelineId = randomUUID();
  const stageId = randomUUID();
  await h.pool.query("INSERT INTO visibility_groups(id,name) VALUES($1,$2)", [
    groupId,
    `Restricted snapshot ${groupId}`,
  ]);
  await h.pool.query("INSERT INTO pipelines(id,name,visibility_group_id) VALUES($1,$2,$3)", [
    pipelineId,
    "Restricted snapshot pipeline",
    groupId,
  ]);
  await h.pool.query("INSERT INTO stages(id,pipeline_id,name) VALUES($1,$2,'Restricted stage')", [
    stageId,
    pipelineId,
  ]);
  const deal = await insertHistoryDeal(h.pool, { ...f, pipelineId, stageId });
  return { pipelineId, dealId: deal.id };
}

describe("native private inventory snapshot writer", () => {
  test("reports missing capture without attempting to write to missing storage", async () => {
    const h = await makeTestDb();
    try {
      const actor = actorFor(await addUser(h));
      expect(await write(h, actor)).toEqual({ state: "missing", reason: "capture-not-installed" });
    } finally {
      await h.close();
    }
  });

  test("pins the creator, regional scope and minimal exact facts for open and closed live deals", async () => {
    await withCapture(async (h, f, actor) => {
      await h.pool.query(
        "INSERT INTO settings(id,base_currency) VALUES(true,'EUR') ON CONFLICT(id) DO UPDATE SET base_currency='EUR'",
      );
      await setPreferences(
        h.db,
        actor.id,
        {
          timezone: "Europe/Berlin",
          ui: { localePreferences: { locale: "fa", calendar: "persian", timeZone: "Asia/Tehran" } },
        },
        signal(),
      );
      const contactId = randomUUID();
      await h.pool.query(
        "INSERT INTO persons(id,name,owner_id,visibility_level) VALUES($1,'Private contact',$2,'owner')",
        [contactId, actor.id],
      );
      await h.pool.query(
        `UPDATE deals SET person_id=$2,source_channel='private-source',title='Private title'
         WHERE id=$1`,
        [f.dealId, contactId],
      );
      const won = await insertHistoryDeal(h.pool, f, { value: "0.0000" });
      const lost = await insertHistoryDeal(h.pool, f, { value: null });
      await h.pool.query(
        "UPDATE deals SET status='won',won_time='2026-03-21T12:30:00.123456Z' WHERE id=$1",
        [won.id],
      );
      await h.pool.query(
        "UPDATE deals SET status='lost',lost_time='2026-03-21T12:30:00.654321Z' WHERE id=$1",
        [lost.id],
      );
      await insertHistoryDeal(h.pool, f, { currency: "USD", value: "200.0001" });
      const archived = await insertHistoryDeal(h.pool, f);
      await h.pool.query("UPDATE deals SET archived_at=clock_timestamp() WHERE id=$1", [
        archived.id,
      ]);

      const result = await write(h, actor, {
        pipelineId: f.pipelineId,
        ownerScope: { kind: "all" },
      });
      requireCreated(result);
      expect(result.factCount).toBe(3);
      expect(result.observedAt).toMatch(/\.\d{6}Z$/);
      expect(Object.keys(result).sort()).toEqual([
        "factCount",
        "observedAt",
        "snapshotId",
        "state",
      ]);
      const row = await stored(h, result);
      expect(row).toMatchObject({
        kind: "pipeline-inventory",
        definitionVersion: 1,
        reportDefinition: {
          id: "current-pipeline-inventory",
          factMembership: "active-deals-in-selected-currency",
          stockStatus: "open",
          absentKey: "no-physical-absence-inference",
        },
        scope: {
          pipelineId: f.pipelineId,
          ownerScope: { kind: "me" },
          owners: { everyone: false, ids: [actor.id] },
        },
        currency: "EUR",
        timeZone: "Europe/Berlin",
        calendar: "persian",
        observedAt: result.observedAt,
        createdBy: actor.id,
        highWater: null,
        targetFrom: null,
        targetToExclusive: null,
        modelVersion: null,
        modelDefinition: null,
      });
      expect(row.snapshot).toMatch(/^\d+:\d+:(?:\d+(?:,\d+)*)?$/);
      const expected = await Promise.all(
        [
          { id: f.dealId, status: "open", value: EXACT_LEGACY_VALUE },
          { id: won.id, status: "won", value: "0.0000" },
          { id: lost.id, status: "lost", value: null },
        ].map(async (fact) => {
          const head = await readCaptureHead(h.pool, "deal", fact.id);
          return {
            entityId: fact.id,
            incarnationId: head.incarnationId,
            tipOrdinal: head.lastEventOrdinal,
            pipelineId: f.pipelineId,
            stageId: f.stageId,
            ownerId: actor.id,
            status: fact.status,
            currency: "EUR",
            value: fact.value,
          };
        }),
      );
      expect(row.records).toEqual(expected.sort((a, b) => a.entityId.localeCompare(b.entityId)));
      const events = await readCaptureEvents(h.pool, "deal", f.dealId);
      expect(events.at(-1)?.afterState).toMatchObject({
        personId: contactId,
        title: "Private title",
      });
      expect(row.activationId).toBe(events[0]?.activationId);
    });
  });

  test("keeps the request ceiling and live record visibility independent of owner selection", async () => {
    await withCapture(async (h, f, actor) => {
      const otherId = await addUser(h);
      const other = await insertHistoryDeal(h.pool, { ...f, userId: otherId });
      await h.pool.query("UPDATE deals SET visibility_level='all' WHERE id=$1", [other.id]);
      const privateOther = await insertHistoryDeal(h.pool, { ...f, userId: otherId });
      const restricted = await restrictAnotherPipeline(h, f);
      const input = { currency: "EUR", ownerScope: { kind: "all" } } as const;
      const broadRequest = actorFor(actor.id, ["stats.viewOthers"]);
      const revoked = await write(h, broadRequest, input);
      requireCreated(revoked);
      expect((await stored(h, revoked)).records.map(({ entityId }) => entityId)).toEqual([
        f.dealId,
      ]);

      const permission = randomUUID();
      await h.pool.query("INSERT INTO permission_sets(id,name,flags) VALUES($1,$2,$3)", [
        permission,
        `Inventory ${permission}`,
        JSON.stringify({ "stats.viewOthers": true }),
      ]);
      await h.pool.query("UPDATE users SET permission_set_id=$2 WHERE id=$1", [
        actor.id,
        permission,
      ]);
      const capped = await write(h, actor, input);
      requireCreated(capped);
      expect((await stored(h, capped)).records.map(({ entityId }) => entityId)).toEqual([f.dealId]);

      const authorized = await write(h, broadRequest, input);
      requireCreated(authorized);
      const row = await stored(h, authorized);
      expect(row.scope).toEqual({
        pipelineId: null,
        ownerScope: { kind: "all" },
        owners: { everyone: true },
      });
      const ids = row.records.map(({ entityId }) => entityId);
      expect(ids).toEqual([f.dealId, other.id].sort());
      expect(ids).not.toContain(privateOther.id);
      expect(ids).not.toContain(restricted.dealId);

      expect(await write(h, broadRequest, { ...input, pipelineId: restricted.pipelineId })).toEqual(
        {
          state: "unavailable",
          reason: "snapshot-scope-unavailable",
        },
      );
      expect(await snapshotCount(h)).toBe(3);
    });
  });

  test("rejects caller-owned metadata and an unsupported stored default currency", async () => {
    await withCapture(async (h, _f, actor) => {
      const forged = {
        currency: "EUR",
        createdBy: randomUUID(),
        observedAt: "2026-01-01T00:00:00Z",
      };
      expect(await write(h, actor, forged)).toEqual({
        state: "unavailable",
        reason: "invalid-snapshot-request",
      });
      await h.pool.query(
        "INSERT INTO settings(id,base_currency) VALUES(true,'ZZZ') ON CONFLICT(id) DO UPDATE SET base_currency='ZZZ'",
      );
      expect(await write(h, actor, {})).toEqual({
        state: "unavailable",
        reason: "snapshot-scope-unavailable",
      });
      expect(await snapshotCount(h)).toBe(0);
    });
  });

  test("refuses snapshots when the native insert guard is disabled", async () => {
    await withCapture(async (h, _f, actor) => {
      await h.pool.query(
        "ALTER TABLE public.analytics_report_snapshots DISABLE TRIGGER analytics_snapshots_insert_guard",
      );
      expect(await write(h, actor)).toEqual({
        state: "unavailable",
        reason: "capture-safety-unavailable",
      });
      expect(await snapshotCount(h)).toBe(0);
    });
  });

  test("refuses unhealthy capture and never drops a visible row with no matching head", async () => {
    await withCapture(async (h, f, actor) => {
      await h.pool.query("ALTER TABLE deals DISABLE TRIGGER analytics_deals_capture");
      expect(await write(h, actor)).toEqual({
        state: "unavailable",
        reason: "capture-safety-unavailable",
      });
      const uncaptured = await insertHistoryDeal(h.pool, f);
      await h.pool.query("ALTER TABLE deals ENABLE ALWAYS TRIGGER analytics_deals_capture");
      expect(await readCaptureEvents(h.pool, "deal", uncaptured.id)).toEqual([]);
      expect(await write(h, actor)).toEqual({
        state: "unavailable",
        reason: "snapshot-capture-incomplete",
      });
      expect(await snapshotCount(h)).toBe(0);
    });
  });

  test("refuses a cap-plus-one population without persisting a partial snapshot", async () => {
    await withCapture(async (h, f, actor) => {
      await withTransaction(h, async (client) => {
        await client.query("SET LOCAL statement_timeout='20000ms'");
        await client.query(
          `INSERT INTO deals(title,pipeline_id,stage_id,owner_id,visibility_level,currency)
          SELECT 'Inventory bound ' || n, $1::uuid,$2::uuid,$3::uuid,'owner'::visibility_level,'EUR'
          FROM generate_series(1,$4::integer) n`,
          [f.pipelineId, f.stageId, actor.id, MAX_INVENTORY_SNAPSHOT_FACTS],
        );
        await client.query("COMMIT");
      });
      expect(await write(h, actor)).toEqual({
        state: "unavailable",
        reason: "snapshot-fact-limit",
      });
      expect(await snapshotCount(h)).toBe(0);
    });
  });

  test("preserves the native cut when a previously pending source correction commits", async () => {
    await withCapture(async (h, f, actor) => {
      await withTransaction(h, async (client) => {
        const original = await readCaptureHead(h.pool, "deal", f.dealId);
        await client.query("UPDATE deals SET value='10.1234' WHERE id=$1", [f.dealId]);
        const pending = (await readCaptureEvents(client, "deal", f.dealId)).at(-1);
        if (pending === undefined) throw new Error("Expected a pending correction");
        const result = await write(h, actor);
        requireCreated(result);
        await client.query("COMMIT");
        const row = await stored(h, result);
        expect(row.records).toMatchObject([
          { entityId: f.dealId, value: EXACT_LEGACY_VALUE, tipOrdinal: original.lastEventOrdinal },
        ]);
        const witness = await h.pool.query<{ original: boolean; pending: boolean }>(
          `
          SELECT pg_catalog.pg_visible_in_snapshot(b.transaction_id::pg_catalog.xid8,s.transaction_snapshot) AS original,
            pg_catalog.pg_visible_in_snapshot(p.transaction_id::pg_catalog.xid8,s.transaction_snapshot) AS pending
          FROM analytics_report_snapshots s
          JOIN analytics_history_events b ON b.ordinal=$2::bigint
          JOIN analytics_history_events p ON p.event_id=$3::uuid WHERE s.id=$1::uuid`,
          [result.snapshotId, original.lastEventOrdinal, pending.eventId],
        );
        expect(witness.rows).toEqual([{ original: true, pending: false }]);
      });
    });
  });

  test("rejects replaying an older native witness with a fresh cutoff", async () => {
    await withCapture(async (h, f, actor) => {
      const opening = await write(h, actor);
      requireCreated(opening);
      await h.pool.query("UPDATE deals SET value='10.1234' WHERE id=$1", [f.dealId]);
      const change = (await readCaptureEvents(h.pool, "deal", f.dealId)).at(-1);
      if (change === undefined) throw new Error("Expected a committed correction");
      expect(change.eventKind).toBe("update");

      await withTransaction(h, async (client) => {
        await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
        const witness = await client.query<{ oldVisible: boolean; currentVisible: boolean }>(
          `SELECT pg_catalog.pg_visible_in_snapshot(e.transaction_id::pg_catalog.xid8,
              s.transaction_snapshot) AS "oldVisible",
            pg_catalog.pg_visible_in_snapshot(e.transaction_id::pg_catalog.xid8,
              pg_catalog.pg_current_snapshot()) AS "currentVisible"
          FROM public.analytics_report_snapshots s
          CROSS JOIN public.analytics_history_events e
          WHERE s.id=$1::uuid AND e.event_id=$2::uuid`,
          [opening.snapshotId, change.eventId],
        );
        expect(witness.rows).toEqual([{ oldVisible: false, currentVisible: true }]);

        await expect(
          client.query(
            `INSERT INTO public.analytics_report_snapshots (
              activation_id,kind,definition_version,report_definition,scope,currency,time_zone,
              calendar,cutoff_observed_at,transaction_snapshot,records,created_by
            ) SELECT activation_id,kind,definition_version,report_definition,scope,currency,time_zone,
              calendar,pg_catalog.statement_timestamp(),transaction_snapshot,records,created_by
            FROM public.analytics_report_snapshots WHERE id=$1::uuid`,
            [opening.snapshotId],
          ),
        ).rejects.toMatchObject({
          code: "55000",
          message: "analytics snapshot witness does not match the current observation",
        });
      });

      expect(await snapshotCount(h)).toBe(1);
    });
  });

  test("rejects direct snapshot insertion after this transaction wrote a captured deal", async () => {
    await withCapture(async (h, f, actor) => {
      const opening = await write(h, actor);
      requireCreated(opening);
      await withTransaction(h, async (client) => {
        await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
        await client.query("UPDATE public.deals SET value='10.1234' WHERE id=$1", [f.dealId]);
        await expect(
          client.query(
            `INSERT INTO public.analytics_report_snapshots (
              activation_id,kind,definition_version,report_definition,scope,currency,time_zone,
              calendar,cutoff_observed_at,transaction_snapshot,records,created_by
            ) SELECT activation_id,kind,definition_version,report_definition,scope,currency,time_zone,
              calendar,pg_catalog.statement_timestamp(),pg_catalog.pg_current_snapshot(),records,created_by
            FROM public.analytics_report_snapshots WHERE id=$1::uuid`,
            [opening.snapshotId],
          ),
        ).rejects.toMatchObject({
          code: "55000",
          message: "analytics snapshot insert cannot follow pending source writes",
        });
      });
      expect(await snapshotCount(h)).toBe(1);
    });
  });

  test("rejects nested and borrowed transactions without committing their source writes", async () => {
    await withCapture(async (h, f, actor) => {
      const unavailable = { state: "unavailable", reason: "snapshot-transaction-unavailable" };
      await h.db.transaction(async (tx) => {
        expect(
          await writeCurrentInventorySnapshot(tx, actor, { currency: "EUR" }, signal()),
        ).toEqual(unavailable);
      });
      await withTransaction(h, async (client) => {
        await client.query("UPDATE deals SET value='10.1234' WHERE id=$1", [f.dealId]);
        const bound = drizzle(client, { schema });
        expect(
          await writeCurrentInventorySnapshot(bound, actor, { currency: "EUR" }, signal()),
        ).toEqual(unavailable);
        const external = await h.pool.query<{ value: string }>(
          "SELECT value::text FROM deals WHERE id=$1",
          [f.dealId],
        );
        expect(external.rows).toEqual([{ value: EXACT_LEGACY_VALUE }]);
      });
      expect(await snapshotCount(h)).toBe(0);
    });
  });

  test("the proposal rejects mutation, deletion and truncation of a written snapshot", async () => {
    await withCapture(async (h, _f, actor) => {
      const result = await write(h, actor);
      requireCreated(result);
      const initial = await stored(h, result);
      await expect(
        h.pool.query("UPDATE analytics_report_snapshots SET records='[]' WHERE id=$1", [
          result.snapshotId,
        ]),
      ).rejects.toMatchObject({ code: "55000" });
      await expect(
        h.pool.query("DELETE FROM analytics_report_snapshots WHERE id=$1", [result.snapshotId]),
      ).rejects.toMatchObject({ code: "55000" });
      await expect(h.pool.query("TRUNCATE analytics_report_snapshots")).rejects.toMatchObject({
        code: "55000",
      });
      expect(await stored(h, result)).toEqual(initial);
    });
  });
});
