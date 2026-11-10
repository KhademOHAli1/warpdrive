import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import { describe, expect, test } from "vitest";
import type { PermissionFlagKey } from "@/constants/permissionFlags";
import * as schema from "@/db/schema";
import type { PermSetUser } from "@/features/permissions/effective";
import { makeTestDb, type TestDb } from "@/test/db";
import type { DashboardFilters } from "@/types/stats";
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
  type CurrentDealHistory,
  MAX_DEAL_HISTORY_EVENTS,
  readCurrentDealHistory,
  readHistoryInstallation,
} from "./repository";

const filters: DashboardFilters = {
  currency: "EUR",
  pipelineId: null,
  owners: { everyone: true },
  from: "2026-01-01",
  to: "2026-12-31",
  timeZone: "UTC",
};
const signal = () => AbortSignal.timeout(10_000);

function actorFor(id: string): PermSetUser {
  return {
    id,
    type: "regular",
    isActive: true,
    groupIds: new Set<string>(),
    flags: new Set<PermissionFlagKey>(["stats.viewOthers"]),
  };
}

function requireAvailable(
  result: CurrentDealHistory,
): asserts result is Extract<CurrentDealHistory, { state: "available" | "partial" }> {
  expect(result.state).toBe("available");
  if (result.state !== "available")
    throw new Error("Expected a complete current-incarnation history");
}

async function withHistory(
  work: (h: TestDb, fixture: HistoryCaptureFixture, actor: PermSetUser) => Promise<void>,
) {
  const h = await makeTestDb();
  h.pool.options.statement_timeout = 5_000;
  h.pool.options.lock_timeout = 2_000;
  try {
    const fixture = await prepareHistoryCapture(h);
    await work(h, fixture, actorFor(fixture.userId));
  } finally {
    await h.close();
  }
}

async function releaseTransaction(client: PoolClient | undefined) {
  if (client === undefined) return;
  try {
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
}

describe("native current-deal history repository", () => {
  test("reports missing capture without querying nonexistent history tables", async () => {
    const h = await makeTestDb();
    h.pool.options.statement_timeout = 5_000;
    try {
      expect(await readHistoryInstallation(h.db, signal())).toEqual({
        state: "missing",
        reason: "capture-not-installed",
      });
      expect(
        await readCurrentDealHistory(h.db, actorFor(randomUUID()), filters, randomUUID(), signal()),
      ).toEqual({ state: "missing", reason: "capture-not-installed" });
    } finally {
      await h.close();
    }
  });

  test("returns the permitted live incarnation with exact captured facts and its database observation", async () => {
    await withHistory(async (h, f, actor) => {
      const installation = await readHistoryInstallation(h.db, signal());
      expect(installation.state).toBe("installed");
      expect(installation).not.toHaveProperty("baselineDealCount");
      const result = await readCurrentDealHistory(h.db, actor, filters, f.dealId, signal());
      requireAvailable(result);
      expect(result.complete).toBe(true);
      expect(result.limit).toBe(MAX_DEAL_HISTORY_EVENTS);
      expect(result.current.id).toBe(f.dealId);
      expect(result.events).toHaveLength(1);
      expect(result.events[0]).toMatchObject({
        eventKind: "baseline",
        entityId: f.dealId,
        incarnationId: result.current.incarnationId,
        activationId: result.activation.activationId,
        actorId: null,
        commandId: null,
        afterState: { value: EXACT_LEGACY_VALUE, ownerId: f.userId },
      });
      expect(result.observation.databaseSnapshot).toMatch(/^\d+:\d+:(?:\d+(?:,\d+)*)?$/);
      expect(result.observation.observedAt).toMatch(/\.\d{6}Z$/);
      expect(result.events[0]?.observationSnapshot).toMatch(/^\d+:\d+:(?:\d+(?:,\d+)*)?$/);
    });
  });

  test("does not let broad reporting scope expose another owner's private deal", async () => {
    await withHistory(async (h, f) => {
      const stranger = randomUUID();
      await h.pool.query("INSERT INTO users (id,email,name) VALUES ($1,$2,'Other viewer')", [
        stranger,
        `${stranger}@example.test`,
      ]);
      expect(
        await readCurrentDealHistory(h.db, actorFor(stranger), filters, f.dealId, signal()),
      ).toEqual({ state: "unavailable", reason: "not-visible-or-not-recorded" });
    });
  });

  test("reads a current deal whose stored UUID uses legacy variant bits", async () => {
    await withHistory(async (h, f, actor) => {
      const legacyId = "00000000-0000-0000-0000-0000f00d0001";
      await insertHistoryDeal(h.pool, f, { id: legacyId, title: "Legacy identifier opportunity" });
      const result = await readCurrentDealHistory(h.db, actor, filters, legacyId, signal());
      requireAvailable(result);
      expect(result.current.id).toBe(legacyId);
      expect(result.events).toHaveLength(1);
      expect(result.events[0]).toMatchObject({ entityId: legacyId, eventKind: "insert" });
    });
  });

  test("uses native snapshot visibility with a public schema shadow type", async () => {
    await withHistory(async (h, f, actor) => {
      await h.pool.query("CREATE DOMAIN public.pg_snapshot AS pg_catalog.text");
      let client: PoolClient | undefined;
      try {
        client = await h.pool.connect();
        await beginHistoryTransaction(client);
        await client.query("SET LOCAL search_path = public, pg_catalog");
        const scopedDb = drizzle(client, { schema });
        const result = await readCurrentDealHistory(scopedDb, actor, filters, f.dealId, signal());
        requireAvailable(result);
        expect(result.events).toHaveLength(1);
        expect(result.events[0]?.eventKind).toBe("baseline");
      } finally {
        await releaseTransaction(client);
      }
    });
  });

  test("reapplies the view-others ceiling even when caller filters request every owner", async () => {
    await withHistory(async (h, f, actor) => {
      const otherOwner = randomUUID();
      await h.pool.query("INSERT INTO users (id,email,name) VALUES ($1,$2,'Second deal owner')", [
        otherOwner,
        `${otherOwner}@example.test`,
      ]);
      const otherDeal = await insertHistoryDeal(
        h.pool,
        { ...f, userId: otherOwner },
        {
          title: "Visible deal owned by someone else",
        },
      );
      await h.pool.query("UPDATE deals SET visibility_level='all' WHERE id=$1", [otherDeal.id]);
      const permitted = await readCurrentDealHistory(h.db, actor, filters, otherDeal.id, signal());
      requireAvailable(permitted);
      expect(permitted.current.id).toBe(otherDeal.id);
      expect(permitted.events.at(-1)?.afterState?.ownerId).toBe(otherOwner);

      const withoutViewOthers: PermSetUser = { ...actor, flags: new Set<PermissionFlagKey>() };
      expect(withoutViewOthers.isActive).toBe(true);
      expect(
        await readCurrentDealHistory(h.db, withoutViewOthers, filters, otherDeal.id, signal()),
      ).toEqual({ state: "unavailable", reason: "not-visible-or-not-recorded" });
    });
  });

  test("applies the current restricted-pipeline gate even to the deal owner", async () => {
    await withHistory(async (h, f, actor) => {
      const groupId = randomUUID();
      await h.pool.query("INSERT INTO visibility_groups (id,name) VALUES ($1,$2)", [
        groupId,
        `Restricted history ${groupId}`,
      ]);
      await h.pool.query("UPDATE pipelines SET visibility_group_id=$2 WHERE id=$1", [
        f.pipelineId,
        groupId,
      ]);
      expect(await readCurrentDealHistory(h.db, actor, filters, f.dealId, signal())).toEqual({
        state: "unavailable",
        reason: "not-visible-or-not-recorded",
      });
    });
  });

  test.each([
    ["archived deal", "UPDATE deals SET archived_at=clock_timestamp() WHERE id=$1", "deal"],
    ["deleted deal", "UPDATE deals SET deleted_at=clock_timestamp() WHERE id=$1", "deal"],
    ["archived pipeline", "UPDATE pipelines SET is_archived=true WHERE id=$1", "pipeline"],
  ] as const)("fails closed for a currently %s", async (_label, update, entity) => {
    await withHistory(async (h, f, actor) => {
      await h.pool.query(update, [entity === "deal" ? f.dealId : f.pipelineId]);
      expect(await readCurrentDealHistory(h.db, actor, filters, f.dealId, signal())).toEqual({
        state: "unavailable",
        reason: "not-visible-or-not-recorded",
      });
    });
  });

  test("returns only the current incarnation when a deleted UUID has been reused", async () => {
    await withHistory(async (h, f, actor) => {
      const original = await readCurrentDealHistory(h.db, actor, filters, f.dealId, signal());
      requireAvailable(original);
      await h.pool.query("DELETE FROM deals WHERE id=$1", [f.dealId]);
      await insertHistoryDeal(h.pool, f, {
        id: f.dealId,
        title: "Reinserted opportunity",
        value: "0.0001",
      });
      const result = await readCurrentDealHistory(h.db, actor, filters, f.dealId, signal());
      requireAvailable(result);
      expect(result.current.incarnationId).not.toBe(original.current.incarnationId);
      expect(result.events).toHaveLength(1);
      expect(result.events[0]).toMatchObject({
        eventKind: "insert",
        beforeState: null,
        afterState: { value: "0.0001" },
      });
      expect(
        result.events.every((event) => event.incarnationId === result.current.incarnationId),
      ).toBe(true);
      expect(await readCaptureEvents(h.pool, "deal", f.dealId)).toHaveLength(3);
    });
  });

  test("keeps unchanged material history readable after a metadata-only write-version rotation", async () => {
    await withHistory(async (h, f, actor) => {
      const before = await readCurrentDealHistory(h.db, actor, filters, f.dealId, signal());
      requireAvailable(before);
      const head = await readCaptureHead(h.pool, "deal", f.dealId);
      const rotated = await h.pool.query<{ version: string }>(
        `UPDATE deals SET board_position=board_position+1,updated_at=clock_timestamp()
         WHERE id=$1 RETURNING write_version::text AS version`,
        [f.dealId],
      );
      expect(rotated.rows).toHaveLength(1);
      expect(rotated.rows[0]?.version).not.toBe(head.lastWriteVersion);
      expect(await readCaptureHead(h.pool, "deal", f.dealId)).toEqual(head);
      const result = await readCurrentDealHistory(h.db, actor, filters, f.dealId, signal());
      requireAvailable(result);
      expect(result.events).toEqual(before.events);
      expect(result.current).toEqual(before.current);
    });
  });

  test.each(["deal", "stage"] as const)(
    "rejects its own uncommitted material %s writes through a transaction-bound database",
    async (entity) => {
      await withHistory(async (h, f, actor) => {
        let client: PoolClient | undefined;
        try {
          client = await h.pool.connect();
          await beginHistoryTransaction(client);
          if (entity === "deal") {
            await client.query("UPDATE deals SET value='0.1234' WHERE id=$1", [f.dealId]);
          } else {
            await client.query("UPDATE stages SET name='Pending definition write' WHERE id=$1", [
              f.stageId,
            ]);
          }
          const transactionDb = drizzle(client, { schema });
          expect(
            await readCurrentDealHistory(transactionDb, actor, filters, f.dealId, signal()),
          ).toEqual({ state: "unavailable", reason: "source-writes-pending" });
          await client.query("ROLLBACK");
          const outside = await readCurrentDealHistory(h.db, actor, filters, f.dealId, signal());
          requireAvailable(outside);
          expect(outside.events).toHaveLength(1);
          expect(outside.events[0]?.afterState?.value).toBe(EXACT_LEGACY_VALUE);
        } finally {
          await releaseTransaction(client);
        }
      });
    },
  );

  test("returns unavailable when a required capture guard is disabled", async () => {
    await withHistory(async (h, f, actor) => {
      await h.pool.query("ALTER TABLE deals DISABLE TRIGGER analytics_deals_capture");
      expect(await readHistoryInstallation(h.db, signal())).toEqual({
        state: "unavailable",
        reason: "capture-safety-unavailable",
      });
      expect(await readCurrentDealHistory(h.db, actor, filters, f.dealId, signal())).toEqual({
        state: "unavailable",
        reason: "capture-safety-unavailable",
      });
    });
  });

  test.each([
    [
      "wrong event type",
      "CREATE TRIGGER analytics_deals_capture AFTER INSERT ON deals FOR EACH ROW EXECUTE FUNCTION analytics_capture_row_change()",
    ],
    [
      "WHEN false",
      "CREATE TRIGGER analytics_deals_capture AFTER INSERT OR UPDATE OR DELETE ON deals FOR EACH ROW WHEN (false) EXECUTE FUNCTION analytics_capture_row_change()",
    ],
  ])("rejects a same-name, always-enabled capture trigger with %s", async (_label, declaration) => {
    await withHistory(async (h, f, actor) => {
      await h.pool.query("DROP TRIGGER analytics_deals_capture ON deals");
      await h.pool.query(declaration);
      await h.pool.query("ALTER TABLE deals ENABLE ALWAYS TRIGGER analytics_deals_capture");
      expect(await readHistoryInstallation(h.db, signal())).toEqual({
        state: "unavailable",
        reason: "capture-safety-unavailable",
      });
      expect(await readCurrentDealHistory(h.db, actor, filters, f.dealId, signal())).toEqual({
        state: "unavailable",
        reason: "capture-safety-unavailable",
      });
    });
  });

  test("does not turn re-enabling a guard into proof that an uncaptured edit has history", async () => {
    await withHistory(async (h, f, actor) => {
      await h.pool.query("ALTER TABLE deals DISABLE TRIGGER analytics_deals_capture");
      await h.pool.query("UPDATE deals SET value='123.0001' WHERE id=$1", [f.dealId]);
      await h.pool.query("ALTER TABLE deals ENABLE ALWAYS TRIGGER analytics_deals_capture");
      expect((await readHistoryInstallation(h.db, signal())).state).toBe("installed");
      expect(await readCurrentDealHistory(h.db, actor, filters, f.dealId, signal())).toEqual({
        state: "unavailable",
        reason: "history-invalid",
      });
    });
  });

  test("withholds a visible current deal's history when its previous pipeline is now hidden", async () => {
    await withHistory(async (h, f, actor) => {
      const destinationId = randomUUID();
      const destinationStage = randomUUID();
      await h.pool.query("INSERT INTO pipelines (id,name) VALUES ($1,'Visible destination')", [
        destinationId,
      ]);
      await h.pool.query(
        "INSERT INTO stages (id,pipeline_id,name) VALUES ($1,$2,'Destination stage')",
        [destinationStage, destinationId],
      );
      await h.pool.query("UPDATE deals SET pipeline_id=$2,stage_id=$3 WHERE id=$1", [
        f.dealId,
        destinationId,
        destinationStage,
      ]);
      const visible = await readCurrentDealHistory(h.db, actor, filters, f.dealId, signal());
      requireAvailable(visible);
      expect(visible.events).toHaveLength(2);
      const groupId = randomUUID();
      await h.pool.query("INSERT INTO visibility_groups (id,name) VALUES ($1,$2)", [
        groupId,
        `Historic restriction ${groupId}`,
      ]);
      await h.pool.query("UPDATE pipelines SET visibility_group_id=$2 WHERE id=$1", [
        f.pipelineId,
        groupId,
      ]);
      expect(await readCurrentDealHistory(h.db, actor, filters, f.dealId, signal())).toEqual({
        state: "unavailable",
        reason: "history-permission-limited",
      });
    });
  });

  test("does not authorize an old restricted pipeline through a recreated visible pipeline with the same UUID", async () => {
    await withHistory(async (h, f, actor) => {
      const oldPipeline = await readCaptureHead(h.pool, "pipeline", f.pipelineId);
      const destinationId = randomUUID();
      const destinationStage = randomUUID();
      const groupId = randomUUID();
      await h.pool.query(
        "INSERT INTO pipelines (id,name) VALUES ($1,'Stable visible destination')",
        [destinationId],
      );
      await h.pool.query(
        "INSERT INTO stages (id,pipeline_id,name) VALUES ($1,$2,'Stable destination stage')",
        [destinationStage, destinationId],
      );
      await h.pool.query("INSERT INTO visibility_groups (id,name) VALUES ($1,$2)", [
        groupId,
        `Old restricted pipeline ${groupId}`,
      ]);
      await h.pool.query("UPDATE pipelines SET visibility_group_id=$2 WHERE id=$1", [
        f.pipelineId,
        groupId,
      ]);
      await h.pool.query("UPDATE deals SET pipeline_id=$2,stage_id=$3 WHERE id=$1", [
        f.dealId,
        destinationId,
        destinationStage,
      ]);
      expect(await readCurrentDealHistory(h.db, actor, filters, f.dealId, signal())).toEqual({
        state: "unavailable",
        reason: "history-permission-limited",
      });
      await h.pool.query("DELETE FROM pipelines WHERE id=$1", [f.pipelineId]);
      await h.pool.query(
        "INSERT INTO pipelines (id,name,visibility_group_id) VALUES ($1,'New public incarnation',NULL)",
        [f.pipelineId],
      );
      const newPipeline = await readCaptureHead(h.pool, "pipeline", f.pipelineId);
      expect(newPipeline.active).toBe(true);
      expect(newPipeline.incarnationId).not.toBe(oldPipeline.incarnationId);
      expect(
        (
          await h.pool.query<{ unrestricted: boolean }>(
            "SELECT visibility_group_id IS NULL AS unrestricted FROM pipelines WHERE id=$1",
            [f.pipelineId],
          )
        ).rows,
      ).toEqual([{ unrestricted: true }]);
      expect(await readCurrentDealHistory(h.db, actor, filters, f.dealId, signal())).toEqual({
        state: "unavailable",
        reason: "history-permission-limited",
      });
    });
  });

  test("marks an oversized incarnation partial and never silently presents a truncated chain as complete", async () => {
    await withHistory(async (h, f, actor) => {
      let client: PoolClient | undefined;
      try {
        client = await h.pool.connect();
        await client.query(
          "BEGIN; SET LOCAL statement_timeout='20000ms'; SET LOCAL lock_timeout='1500ms'",
        );
        await client.query(
          `DO $$ DECLARE i integer; BEGIN
             FOR i IN 1..${MAX_DEAL_HISTORY_EVENTS} LOOP
               UPDATE deals SET value=i::numeric WHERE id='${f.dealId}'::uuid;
             END LOOP;
           END $$`,
        );
        await client.query("COMMIT; SET statement_timeout='20000ms'");
        const observedDb = drizzle(client, { schema });
        const result = await readCurrentDealHistory(
          observedDb,
          actor,
          filters,
          f.dealId,
          AbortSignal.timeout(25_000),
        );
        expect(result.state).toBe("partial");
        if (result.state !== "partial") throw new Error("Expected bounded partial history");
        expect(result.complete).toBe(false);
        expect(result.limit).toBe(MAX_DEAL_HISTORY_EVENTS);
        expect(result.events).toHaveLength(MAX_DEAL_HISTORY_EVENTS);
        expect(result.events[0]?.eventKind).toBe("baseline");
        const head = await readCaptureHead(client, "deal", f.dealId);
        expect(result.events.at(-1)?.ordinal).not.toBe(head.lastEventOrdinal);
      } finally {
        await releaseTransaction(client);
      }
    });
  });
});
