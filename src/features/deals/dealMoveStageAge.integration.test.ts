import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { changeLogs } from "@/db/schema";
import { deals } from "@/db/schema/deals";
import { withTestDb } from "@/db/testing";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { createDeal, moveDeal } from "./dealActions";
import { adminSession, createSession, seedSettings } from "./dealMove.test-helpers";

type Db = Parameters<Parameters<typeof withTestDb>[0]>[0];
const CREATED_AT = "2001-01-01T10:00:00.000Z";
const STAGE_ENTERED_AT = "2001-02-01T10:00:00.000Z";
const UPDATED_AT = "2001-02-02T10:00:00.000Z";
const signal = () => AbortSignal.timeout(10_000);

async function seedOldDeal(db: Db) {
  await seedSettings(db);
  const user = await seedUser(db, { isAdmin: true });
  const { pipeline, stages } = await seedPipelineWithStages(db, ["Intake", "Qualified"]);
  const first = stages[0];
  const second = stages[1];
  if (first === undefined || second === undefined) {
    throw new AppError(ERROR_IDS.DB_INVARIANT, "stage-age fixture requires two stages");
  }
  // Supplied domain actors do not represent a native Better Auth session fixture.
  const created = await createDeal(
    db,
    createSession(user.id),
    { title: "Established stage stay", pipelineId: pipeline.id, stageId: first.id },
    signal(),
  );
  if (!created.ok) throw created.error;
  const [deal] = await db
    .update(deals)
    .set({
      createdAt: new Date(CREATED_AT),
      stageEnteredAt: new Date(STAGE_ENTERED_AT),
      updatedAt: new Date(UPDATED_AT),
      boardPosition: "2",
    })
    .where(eq(deals.id, created.value.id))
    .returning();
  if (deal === undefined) {
    throw new AppError(ERROR_IDS.DB_INVARIANT, "stage-age fixture deal is missing");
  }
  return { deal, first, second, actor: adminSession(user.id) };
}

async function stageLogs(db: Db, dealId: string) {
  return db
    .select()
    .from(changeLogs)
    .where(and(eq(changeLogs.entityId, dealId), eq(changeLogs.field, "stageId")));
}

async function storedDeal(db: Db, dealId: string) {
  const [deal] = await db.select().from(deals).where(eq(deals.id, dealId));
  if (deal === undefined) {
    throw new AppError(ERROR_IDS.DB_INVARIANT, "moved stage-age fixture deal is missing");
  }
  return deal;
}

describe("moveDeal preserves the start of an unchanged stage stay", () => {
  it("changes order within the same stage without resetting entry time or adding a stage log", async () => {
    await withTestDb(async (db) => {
      const { deal, first, actor } = await seedOldDeal(db);
      const beforeLogs = await stageLogs(db, deal.id);
      expect(beforeLogs).toHaveLength(0);
      expect(deal.boardPosition).toBe("2");
      expect(deal.stageEnteredAt.toISOString()).toBe(STAGE_ENTERED_AT);

      const moved = await moveDeal(
        db,
        actor,
        {
          dealId: deal.id,
          toStageId: first.id,
          beforePosition: "10",
          afterPosition: "20",
          expectedUpdatedAt: deal.updatedAt.toISOString(),
        },
        signal(),
      );
      expect(moved.ok).toBe(true);
      if (!moved.ok) throw moved.error;
      const persisted = await storedDeal(db, deal.id);
      expect(moved.value.stageId).toBe(first.id);
      expect(persisted.stageId).toBe(first.id);
      expect(moved.value.boardPosition).toBe("15");
      expect(persisted.boardPosition).toBe("15");
      expect(persisted.createdAt.toISOString()).toBe(CREATED_AT);
      expect(await stageLogs(db, deal.id)).toEqual(beforeLogs);
      expect({
        returned: moved.value.stageEnteredAt.toISOString(),
        persisted: persisted.stageEnteredAt.toISOString(),
      }).toEqual({ returned: STAGE_ENTERED_AT, persisted: STAGE_ENTERED_AT });
    });
  });

  it("starts a new stage stay and writes one stage log on an actual cross-stage move", async () => {
    await withTestDb(async (db) => {
      const { deal, first, second, actor } = await seedOldDeal(db);
      expect(await stageLogs(db, deal.id)).toHaveLength(0);
      const moved = await moveDeal(
        db,
        actor,
        {
          dealId: deal.id,
          toStageId: second.id,
          beforePosition: "10",
          afterPosition: "20",
          expectedUpdatedAt: deal.updatedAt.toISOString(),
        },
        signal(),
      );
      expect(moved.ok).toBe(true);
      if (!moved.ok) throw moved.error;
      const persisted = await storedDeal(db, deal.id);
      expect(moved.value.stageId).toBe(second.id);
      expect(persisted.stageId).toBe(second.id);
      expect(persisted.boardPosition).toBe("15");
      expect(persisted.createdAt.toISOString()).toBe(CREATED_AT);
      // A historical fixture avoids sleeps and a fragile wall-clock tolerance.
      expect(moved.value.stageEnteredAt.getTime()).toBeGreaterThan(deal.stageEnteredAt.getTime());
      expect(persisted.stageEnteredAt.toISOString()).toBe(moved.value.stageEnteredAt.toISOString());
      const logs = await stageLogs(db, deal.id);
      expect(logs).toHaveLength(1);
      expect(logs[0]?.oldValue).toBe(first.id);
      expect(logs[0]?.newValue).toBe(second.id);
    });
  });
});
