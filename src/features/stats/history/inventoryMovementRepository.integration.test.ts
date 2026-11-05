import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { PermSetUser } from "@/features/permissions/effective";
import { makeTestDb, type TestDb } from "@/test/db";
import {
  beginHistoryTransaction,
  type HistoryCaptureFixture,
  insertHistoryDeal,
  prepareHistoryCapture,
  readCaptureEvents,
} from "./capture.test-helpers";
import { readInventoryMovementBetweenSnapshots } from "./inventoryMovementRepository";
import { writeCurrentInventorySnapshot } from "./inventorySnapshotRepository";

const signal = () => AbortSignal.timeout(10_000);

function actorFor(id: string): PermSetUser {
  return {
    id,
    type: "regular",
    isActive: true,
    groupIds: new Set(),
    flags: new Set(),
  };
}

async function withCapture(
  run: (h: TestDb, f: HistoryCaptureFixture, actor: PermSetUser) => Promise<void>,
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

async function pin(h: TestDb, actor: PermSetUser, pipelineId: string) {
  const written = await writeCurrentInventorySnapshot(
    h.db,
    actor,
    { currency: "EUR", pipelineId },
    signal(),
  );
  if (written.state !== "created")
    throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "Expected an inventory snapshot receipt");
  return written.snapshotId;
}

function compare(
  h: TestDb,
  actor: PermSetUser,
  openingSnapshotId: string,
  closingSnapshotId: string,
) {
  return readInventoryMovementBetweenSnapshots(
    h.db,
    actor,
    { openingSnapshotId, closingSnapshotId },
    signal(),
  );
}

describe("native creator-owned inventory movement comparison", () => {
  test("reconstructs both books with exact money and retains their original event witness", async () => {
    await withCapture(async (h, f, actor) => {
      const opening = await pin(h, actor, f.pipelineId);
      await h.pool.query("UPDATE deals SET value='99999999999999.1235' WHERE id=$1", [f.dealId]);
      const closing = await pin(h, actor, f.pipelineId);
      const change = (await readCaptureEvents(h.pool, "deal", f.dealId)).at(-1);
      if (change === undefined)
        throw new AppError(ERROR_IDS.DB_READ_FAILED, "Expected the value change witness");

      const report = await compare(h, actor, opening, closing);
      expect(report).toMatchObject({
        state: "available",
        basis: "current-authorized-pinned-inventory",
        opening: { snapshotId: opening },
        closing: { snapshotId: closing },
        result: {
          opening: { count: 1, knownValue: "99999999999999.1234" },
          closing: { count: 1, knownValue: "99999999999999.1235" },
          netMovement: { count: 0, knownValue: "0.0001" },
          movements: [{ category: "value-increase", source: { eventIds: [change.eventId] } }],
        },
      });
      expect(JSON.stringify(report)).not.toContain("transactionSnapshot");
      expect(JSON.stringify(report)).not.toContain("beforeState");
      expect(await compare(h, actor, closing, opening)).toEqual({
        state: "unavailable",
        reason: "snapshot-order-unproven",
      });
    });
  });

  test("admits a low-ordinal transaction only after the closing cut sees its commit", async () => {
    await withCapture(async (h, f, actor) => {
      const other = await insertHistoryDeal(h.pool, f);
      const pending = await h.pool.connect();
      try {
        await beginHistoryTransaction(pending);
        await pending.query("UPDATE deals SET value='8.0000' WHERE id=$1", [f.dealId]);
        const pendingChange = (await readCaptureEvents(pending, "deal", f.dealId)).at(-1);
        await h.pool.query("UPDATE deals SET status='won',won_time=clock_timestamp() WHERE id=$1", [
          other.id,
        ]);
        const highChange = (await readCaptureEvents(h.pool, "deal", other.id)).at(-1);
        if (pendingChange === undefined || highChange === undefined)
          throw new AppError(ERROR_IDS.DB_READ_FAILED, "Expected both transaction witnesses");
        expect(BigInt(pendingChange.ordinal)).toBeLessThan(BigInt(highChange.ordinal));

        const opening = await pin(h, actor, f.pipelineId);
        await pending.query("COMMIT");
        const closing = await pin(h, actor, f.pipelineId);
        const report = await compare(h, actor, opening, closing);
        expect(report).toMatchObject({
          state: "available",
          result: {
            opening: { count: 1, knownValue: "99999999999999.1234" },
            closing: { count: 1, knownValue: "8.0000" },
            movements: [
              { category: "value-decrease", source: { eventIds: [pendingChange.eventId] } },
            ],
          },
        });
      } finally {
        try {
          await pending.query("ROLLBACK");
        } finally {
          pending.release();
        }
      }
    });
  });

  test("retains an observed insert and transfer that appears in neither pinned book", async () => {
    await withCapture(async (h, f, actor) => {
      const destination = randomUUID();
      const stage = randomUUID();
      await h.pool.query("INSERT INTO pipelines(id,name) VALUES ($1,'Destination')", [destination]);
      await h.pool.query(
        "INSERT INTO stages(id,pipeline_id,name) VALUES ($1,$2,'Destination stage')",
        [stage, destination],
      );
      const opening = await pin(h, actor, f.pipelineId);
      const entrant = await insertHistoryDeal(h.pool, f, { value: "12.0000" });
      await h.pool.query("UPDATE deals SET pipeline_id=$2,stage_id=$3 WHERE id=$1", [
        entrant.id,
        destination,
        stage,
      ]);
      const closing = await pin(h, actor, f.pipelineId);
      expect(await compare(h, actor, opening, closing)).toMatchObject({
        state: "available",
        result: {
          netMovement: { count: 0, knownValue: "0.0000" },
          movements: [{ category: "new" }, { category: "transfer-out" }],
        },
      });
    });
  });

  test("excludes a coherent unrelated lowercase currency chain before report decoding", async () => {
    await withCapture(async (h, f, actor) => {
      const unrelated = await insertHistoryDeal(h.pool, f, { currency: "usd", value: "21.0000" });
      const opening = await pin(h, actor, f.pipelineId);
      await h.pool.query("UPDATE deals SET value='22.0000' WHERE id=$1", [unrelated.id]);
      await h.pool.query("UPDATE deals SET value='99999999999999.1235' WHERE id=$1", [f.dealId]);
      const closing = await pin(h, actor, f.pipelineId);
      expect(await compare(h, actor, opening, closing)).toMatchObject({
        state: "available",
        result: {
          currency: "EUR",
          opening: { count: 1, knownValue: "99999999999999.1234" },
          closing: { count: 1, knownValue: "99999999999999.1235" },
          movements: [{ category: "value-increase", entityId: f.dealId }],
        },
      });
    });
  });

  test("does not spend the history payload budget on writes after the closing cut", async () => {
    await withCapture(async (h, f, actor) => {
      const opening = await pin(h, actor, f.pipelineId);
      const closing = await pin(h, actor, f.pipelineId);
      await h.pool.query("UPDATE deals SET title=repeat('outside cut ',400000) WHERE id=$1", [
        f.dealId,
      ]);
      await h.pool.query("UPDATE deals SET title='Restored current title' WHERE id=$1", [f.dealId]);
      expect(await compare(h, actor, opening, closing)).toMatchObject({
        state: "available",
        result: { netMovement: { count: 0, knownValue: "0.0000" }, movements: [] },
      });
    });
  });

  test("rejects a stored book that omits an unchanged, eligible deal", async () => {
    await withCapture(async (h, f, actor) => {
      const template = await pin(h, actor, f.pipelineId);
      const client = await h.pool.connect();
      let forgedId: string | undefined;
      try {
        await beginHistoryTransaction(client);
        await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
        // The native guard verifies the cut. A deliberately malformed book from the test
        // owner still reaches the reader's independent reconstruction oracle.
        const forged = await client.query<{ id: string }>(
          `INSERT INTO public.analytics_report_snapshots (
            activation_id,kind,definition_version,report_definition,scope,currency,time_zone,
            calendar,cutoff_observed_at,transaction_snapshot,records,created_by
          ) SELECT activation_id,kind,definition_version,report_definition,scope,currency,time_zone,
            calendar,pg_catalog.statement_timestamp(),pg_catalog.pg_current_snapshot(),'[]'::jsonb,
            created_by FROM public.analytics_report_snapshots WHERE id=$1::uuid RETURNING id::text`,
          [template],
        );
        forgedId = forged.rows[0]?.id;
        await client.query("COMMIT");
      } finally {
        try {
          await client.query("ROLLBACK");
        } finally {
          client.release();
        }
      }
      const closing = await pin(h, actor, f.pipelineId);
      if (forgedId === undefined)
        throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "Expected an inconsistent snapshot fixture");
      expect(await compare(h, actor, forgedId, closing)).toEqual({
        state: "unavailable",
        reason: "snapshot-boundary-unproven",
      });
    });
  });

  test("withholds comparisons after current authority is lost and masks foreign snapshot IDs", async () => {
    await withCapture(async (h, f, actor) => {
      const opening = await pin(h, actor, f.pipelineId);
      const closing = await pin(h, actor, f.pipelineId);
      const outsider = randomUUID();
      await h.pool.query("INSERT INTO users (id,email,name) VALUES ($1,$2,'Other viewer')", [
        outsider,
        `${outsider}@example.test`,
      ]);
      expect(await compare(h, actorFor(outsider), opening, closing)).toEqual({
        state: "unavailable",
        reason: "snapshot-unavailable",
      });

      const restricted = randomUUID();
      await h.pool.query("INSERT INTO visibility_groups(id,name) VALUES ($1,$2)", [
        restricted,
        restricted,
      ]);
      await h.pool.query("UPDATE pipelines SET visibility_group_id=$2 WHERE id=$1", [
        f.pipelineId,
        restricted,
      ]);
      expect(await compare(h, actor, opening, closing)).toEqual({
        state: "unavailable",
        reason: "history-permission-limited",
      });
    });
  });

  test("withholds hard deletion and non-deal pipeline membership changes", async () => {
    await withCapture(async (h, f, actor) => {
      const opening = await pin(h, actor, f.pipelineId);
      await h.pool.query("DELETE FROM deals WHERE id=$1", [f.dealId]);
      const removed = await pin(h, actor, f.pipelineId);
      expect(await compare(h, actor, opening, removed)).toEqual({
        state: "unavailable",
        reason: "retained-history-authority-unavailable",
      });

      await h.pool.query("UPDATE pipelines SET is_archived=true WHERE id=$1", [f.pipelineId]);
      await h.pool.query("UPDATE pipelines SET is_archived=false WHERE id=$1", [f.pipelineId]);
      const restored = await pin(h, actor, f.pipelineId);
      expect(await compare(h, actor, removed, restored)).toEqual({
        state: "unavailable",
        reason: "unmodeled-membership-change",
      });
    });
  });
});
