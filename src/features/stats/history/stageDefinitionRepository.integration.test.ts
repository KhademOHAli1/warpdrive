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
  type HistoryCaptureFixture,
  insertHistoryDeal,
  prepareHistoryCapture,
  readCaptureEvents,
} from "./capture.test-helpers";
import {
  readCurrentDealStageDefinition,
  type StageDefinitionRequest,
} from "./stageDefinitionRepository";

const filters: DashboardFilters = {
  currency: "EUR",
  pipelineId: null,
  owners: { everyone: true },
  from: "2026-01-01",
  to: "2026-12-31",
  timeZone: "UTC",
};
const signal = () => AbortSignal.timeout(10_000);

const noAnchor = { state: "unavailable", reason: "anchor-unavailable" };
const noDefinition = { state: "unavailable", reason: "stage-definition-unavailable" };
const noTransaction = { state: "unavailable", reason: "definition-read-failed" };

function actorFor(id: string): PermSetUser {
  return {
    id,
    type: "regular",
    isActive: true,
    flags: new Set<PermissionFlagKey>(),
    groupIds: new Set<string>(),
  };
}

function request(
  dealId: string,
  anchorEventId: string,
  changes: Partial<StageDefinitionRequest> = {},
) {
  return {
    dealId,
    anchorEventId,
    side: "after",
    ownTransactionPolicy: "include-final-own-transaction",
    ...changes,
  } satisfies StageDefinitionRequest;
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

async function eventAt(
  connection: Pick<TestDb["pool"], "query">,
  kind: "deal" | "stage",
  id: string,
  index: number,
) {
  const event = (await readCaptureEvents(connection, kind, id)).at(index);
  if (event === undefined) throw new Error("Expected a captured fixture event");
  return event;
}

async function insertReplacementStage(
  connection: Pick<TestDb["pool"], "query">,
  f: HistoryCaptureFixture,
) {
  await connection.query(
    `INSERT INTO stages(id,pipeline_id,name,"order",rotting_days)
     VALUES ($1,$2,'Replacement qualification',3,7)`,
    [f.stageId, f.pipelineId],
  );
}

describe("native current-deal stage definition repository", () => {
  test("uses the activation definition only when the shared baseline transaction is admitted", async () => {
    await withCapture(async (h, f, actor) => {
      const anchor = await eventAt(h.pool, "deal", f.dealId, 0);
      const stage = await eventAt(h.pool, "stage", f.stageId, 0);
      expect(anchor.transactionId).toBe(stage.transactionId);
      const input = request(f.dealId, anchor.eventId);
      expect(await readCurrentDealStageDefinition(h.db, actor, filters, input, signal())).toEqual({
        state: "available",
        stageId: f.stageId,
        definition: {
          pipelineId: f.pipelineId,
          name: "Legacy qualification",
          order: 0,
          rottingDays: 14,
        },
        version: {
          activationId: anchor.activationId,
          incarnationId: stage.incarnationId,
          firstOrdinal: stage.ordinal,
          lastOrdinal: stage.ordinal,
          membership: "anchor-transaction-final",
        },
      });
      expect(
        await readCurrentDealStageDefinition(
          h.db,
          actor,
          filters,
          {
            ...input,
            ownTransactionPolicy: "exclude-own-transaction",
          },
          signal(),
        ),
      ).toEqual(noDefinition);
      expect(
        await readCurrentDealStageDefinition(
          h.db,
          actor,
          filters,
          {
            ...input,
            side: "before",
          },
          signal(),
        ),
      ).toEqual(noAnchor);
    });
  });

  test("excludes a late-committing rename even when the rename has the smaller ordinal", async () => {
    await withCapture(async (h, f, actor) => {
      await withTransaction(h, async (rename) => {
        await rename.query("UPDATE stages SET name='Late committed qualification' WHERE id=$1", [
          f.stageId,
        ]);
        const later = await eventAt(rename, "stage", f.stageId, -1);
        const inserted = await insertHistoryDeal(h.pool, f);
        const anchor = await eventAt(h.pool, "deal", inserted.id, 0);
        expect(BigInt(later.ordinal) < BigInt(anchor.ordinal)).toBe(true);
        await rename.query("COMMIT");
        const live = await h.pool.query<{ name: string }>("SELECT name FROM stages WHERE id=$1", [
          f.stageId,
        ]);
        expect(live.rows).toEqual([{ name: "Late committed qualification" }]);
        expect(
          await readCurrentDealStageDefinition(
            h.db,
            actor,
            filters,
            request(inserted.id, anchor.eventId),
            signal(),
          ),
        ).toMatchObject({
          state: "available",
          stageId: f.stageId,
          definition: { name: "Legacy qualification" },
          version: { membership: "snapshot-visible" },
        });

        await h.pool.query("UPDATE deals SET value='42.0001' WHERE id=$1", [inserted.id]);
        const subsequent = await eventAt(h.pool, "deal", inserted.id, -1);
        expect(
          await readCurrentDealStageDefinition(
            h.db,
            actor,
            filters,
            request(inserted.id, subsequent.eventId),
            signal(),
          ),
        ).toMatchObject({
          state: "available",
          definition: { name: "Late committed qualification" },
          version: {
            firstOrdinal: later.ordinal,
            lastOrdinal: later.ordinal,
            membership: "snapshot-visible",
          },
        });
      });
    });
  });

  test("either excludes the anchor transaction or includes its complete final stage version", async () => {
    await withCapture(async (h, f, actor) => {
      await withTransaction(h, async (client) => {
        await client.query("UPDATE stages SET name='Intermediate definition' WHERE id=$1", [
          f.stageId,
        ]);
        await client.query("UPDATE deals SET value='37.0001' WHERE id=$1", [f.dealId]);
        await client.query(`UPDATE stages SET name='Final definition',"order"=5 WHERE id=$1`, [
          f.stageId,
        ]);
        await client.query("COMMIT");
      });
      const anchor = await eventAt(h.pool, "deal", f.dealId, -1);
      const first = await eventAt(h.pool, "stage", f.stageId, 1);
      const last = await eventAt(h.pool, "stage", f.stageId, 2);
      expect([first.transactionId, last.transactionId]).toEqual([
        anchor.transactionId,
        anchor.transactionId,
      ]);
      expect(BigInt(first.ordinal) < BigInt(anchor.ordinal)).toBe(true);
      expect(BigInt(anchor.ordinal) < BigInt(last.ordinal)).toBe(true);
      const input = request(f.dealId, anchor.eventId);
      expect(
        await readCurrentDealStageDefinition(h.db, actor, filters, input, signal()),
      ).toMatchObject({
        state: "available",
        definition: { name: "Final definition", order: 5 },
        version: {
          firstOrdinal: first.ordinal,
          lastOrdinal: last.ordinal,
          membership: "anchor-transaction-final",
        },
      });
      expect(
        await readCurrentDealStageDefinition(
          h.db,
          actor,
          filters,
          {
            ...input,
            ownTransactionPolicy: "exclude-own-transaction",
          },
          signal(),
        ),
      ).toMatchObject({
        state: "available",
        definition: { name: "Legacy qualification", order: 0 },
        version: { membership: "snapshot-visible" },
      });
    });
  });

  test("treats missing and unrelated anchors alike even when their rows exist", async () => {
    await withCapture(async (h, f, actor) => {
      const other = await insertHistoryDeal(h.pool, f);
      const otherAnchor = await eventAt(h.pool, "deal", other.id, 0);
      const stage = await eventAt(h.pool, "stage", f.stageId, 0);
      for (const anchorId of [randomUUID(), otherAnchor.eventId, stage.eventId]) {
        expect(
          await readCurrentDealStageDefinition(
            h.db,
            actor,
            filters,
            request(f.dealId, anchorId),
            signal(),
          ),
        ).toEqual(noAnchor);
      }
    });
  });

  test("denies retired stage history and allows a later anchor for a proved replacement", async () => {
    await withCapture(async (h, f, actor) => {
      const originalAnchor = await eventAt(h.pool, "deal", f.dealId, 0);
      const originalStage = await eventAt(h.pool, "stage", f.stageId, 0);
      await h.pool.query("UPDATE deals SET stage_id=$2 WHERE id=$1", [f.dealId, f.otherStageId]);
      await h.pool.query("DELETE FROM stages WHERE id=$1", [f.stageId]);
      const original = request(f.dealId, originalAnchor.eventId);
      expect(
        await readCurrentDealStageDefinition(h.db, actor, filters, original, signal()),
      ).toEqual(noDefinition);
      await insertReplacementStage(h.pool, f);
      await h.pool.query("UPDATE deals SET stage_id=$2 WHERE id=$1", [f.dealId, f.stageId]);
      const replacementAnchor = await eventAt(h.pool, "deal", f.dealId, -1);
      const replacementStage = await eventAt(h.pool, "stage", f.stageId, -1);
      expect(replacementStage.incarnationId).not.toBe(originalStage.incarnationId);
      expect(
        await readCurrentDealStageDefinition(h.db, actor, filters, original, signal()),
      ).toEqual(noDefinition);
      expect(
        await readCurrentDealStageDefinition(
          h.db,
          actor,
          filters,
          request(f.dealId, replacementAnchor.eventId),
          signal(),
        ),
      ).toMatchObject({
        state: "available",
        definition: { name: "Replacement qualification", order: 3, rottingDays: 7 },
        version: { incarnationId: replacementStage.incarnationId, membership: "snapshot-visible" },
      });
    });
  });

  test("does not bind the previous deal side to a stage recreated later in the anchor transaction", async () => {
    await withCapture(async (h, f, actor) => {
      await withTransaction(h, async (client) => {
        await client.query("UPDATE deals SET stage_id=$2 WHERE id=$1", [f.dealId, f.otherStageId]);
        await client.query("DELETE FROM stages WHERE id=$1", [f.stageId]);
        await insertReplacementStage(client, f);
        await client.query("COMMIT");
      });
      const anchor = await eventAt(h.pool, "deal", f.dealId, -1);
      const replacement = await eventAt(h.pool, "stage", f.stageId, -1);
      expect(anchor.beforeState?.stageId).toBe(f.stageId);
      expect(anchor.transactionId).toBe(replacement.transactionId);
      expect(BigInt(anchor.ordinal) < BigInt(replacement.ordinal)).toBe(true);
      const input = request(f.dealId, anchor.eventId);
      expect(
        await readCurrentDealStageDefinition(
          h.db,
          actor,
          filters,
          {
            ...input,
            side: "before",
          },
          signal(),
        ),
      ).toEqual(noDefinition);
      expect(
        await readCurrentDealStageDefinition(
          h.db,
          actor,
          filters,
          {
            ...input,
            side: "before",
            ownTransactionPolicy: "exclude-own-transaction",
          },
          signal(),
        ),
      ).toEqual(noDefinition);
      expect(
        await readCurrentDealStageDefinition(h.db, actor, filters, input, signal()),
      ).toMatchObject({
        state: "available",
        stageId: f.otherStageId,
        definition: { name: "Legacy proposal" },
      });
    });
  });

  test("rechecks current pipeline membership against a previously hydrated caller", async () => {
    await withCapture(async (h, f, actor) => {
      const group = randomUUID();
      await h.pool.query("INSERT INTO visibility_groups(id,name) VALUES($1,$2)", [
        group,
        `Stage ${group}`,
      ]);
      await h.pool.query("INSERT INTO visibility_group_members(group_id,user_id) VALUES($1,$2)", [
        group,
        actor.id,
      ]);
      await h.pool.query("UPDATE pipelines SET visibility_group_id=$2 WHERE id=$1", [
        f.pipelineId,
        group,
      ]);
      const member = { ...actor, groupIds: new Set([group]) };
      const anchor = await eventAt(h.pool, "deal", f.dealId, 0);
      const input = request(f.dealId, anchor.eventId);
      expect(
        await readCurrentDealStageDefinition(h.db, member, filters, input, signal()),
      ).toMatchObject({
        state: "available",
        definition: { name: "Legacy qualification" },
      });
      await h.pool.query("DELETE FROM visibility_group_members WHERE group_id=$1 AND user_id=$2", [
        group,
        actor.id,
      ]);
      expect(await readCurrentDealStageDefinition(h.db, member, filters, input, signal())).toEqual({
        state: "unavailable",
        reason: "not-visible-or-not-recorded",
      });
    });
  });

  test("rejects nested and client-bound reads without committing pending caller writes", async () => {
    await withCapture(async (h, f, actor) => {
      const anchor = await eventAt(h.pool, "deal", f.dealId, 0);
      const input = request(f.dealId, anchor.eventId);
      await h.db.transaction(async (tx) => {
        expect(await readCurrentDealStageDefinition(tx, actor, filters, input, signal())).toEqual(
          noTransaction,
        );
      });
      await withTransaction(h, async (client) => {
        await client.query("UPDATE deals SET title='Uncommitted caller edit' WHERE id=$1", [
          f.dealId,
        ]);
        const bound = drizzle(client, { schema });
        expect(
          await readCurrentDealStageDefinition(bound, actor, filters, input, signal()),
        ).toEqual(noTransaction);
        const committed = await h.pool.query<{ title: string }>(
          "SELECT title FROM deals WHERE id=$1",
          [f.dealId],
        );
        expect(committed.rows).toEqual([{ title: "Populated legacy opportunity" }]);
        const pending = await client.query<{ title: string }>(
          "SELECT title FROM deals WHERE id=$1",
          [f.dealId],
        );
        expect(pending.rows).toEqual([{ title: "Uncommitted caller edit" }]);
      });
    });
  });
});
