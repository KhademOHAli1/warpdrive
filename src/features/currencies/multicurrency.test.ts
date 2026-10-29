import { describe, expect, it } from "vitest";
import { settings } from "@/db/schema/system";
import { withTestDb } from "@/db/testing";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { createDeal } from "@/features/deals/dealActions";
import { getBoardColumns, getStageSums, listDeals } from "@/features/deals/dealRepo";

describe("currency persistence and totals", () => {
  it("defaults to company currency and keeps foreign amounts separate in reads", async () => {
    await withTestDb(async (db) => {
      await db.insert(settings).values({
        id: true,
        baseCurrency: "EUR",
        defaultVisibilityLevels: { deal: "all", person: "all", organization: "all" },
      });
      const user = await seedUser(db);
      const { pipeline, stages } = await seedPipelineWithStages(db, ["Qualified"]);
      const stage = stages[0];
      expect(stage).toBeDefined();
      if (stage === undefined) return;
      const session = {
        userId: user.id,
        isAdmin: true,
        isActive: true,
        sessionLive: true,
        visibilityGroupIds: [],
        managedUserIds: [],
        primaryVisibilityGroupId: null,
        flags: {},
      };
      const signal = AbortSignal.timeout(30_000);
      const common = { pipelineId: pipeline.id, stageId: stage.id, value: 100 };
      const local = await createDeal(db, session, { ...common, title: "EUR default" }, signal);
      const foreign = await createDeal(
        db,
        session,
        { ...common, title: "USD", currency: "USD" },
        signal,
      );
      expect(local.ok && local.value.currency).toBe("EUR");
      expect(foreign.ok && foreign.value.currency).toBe("USD");
      const board = await getBoardColumns(db, session, pipeline.id, signal);
      expect(board.cards.map((card) => card.currency).sort()).toEqual(["EUR", "USD"]);
      const list = await listDeals(
        db,
        session,
        { pipelineId: pipeline.id, offset: 0, limit: 1 },
        signal,
      );
      expect(list.total).toBe(2);
      expect(list.totalValue).toBeNull();
      expect(list.currencyTotals).toEqual([
        { currency: "EUR", value: "100.00" },
        { currency: "USD", value: "100.00" },
      ]);
      const foreignOnly = await listDeals(
        db,
        session,
        {
          pipelineId: pipeline.id,
          offset: 0,
          limit: 1,
          filter: { conditions: [{ field: "currency", op: "eq", value: "USD" }] },
        },
        signal,
      );
      expect(foreignOnly.totalValue).toBeNull();
      expect(foreignOnly.currencyTotals).toEqual([{ currency: "USD", value: "100.00" }]);
      const sums = await getStageSums(db, session, pipeline.id, signal);
      expect(sums).toHaveLength(2);
      expect(sums.map((sum) => sum.currency).sort()).toEqual(["EUR", "USD"]);
    });
  });
});
