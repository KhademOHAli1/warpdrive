import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { deals } from "@/db/schema/deals";
import { leads } from "@/db/schema/leads";
import { settings } from "@/db/schema/system";
import { withTestDb } from "@/db/testing";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { convertDealToLead } from "@/features/deal-workspace/convertToLead";
import { duplicateDeal } from "@/features/deal-workspace/duplicateDeal";
import { createDeal } from "@/features/deals/dealActions";
import { goalActual } from "@/features/goals/goalActual";
import { goalSeries } from "@/features/goals/goalSeries";
import { createGoal } from "@/features/goals/goalsRepo";
import { dealPerformance } from "@/features/stats/dealPerformance";
import { toActor } from "@/features/stats/statsTestHelpers";
import { wonDealStats } from "@/features/stats/wonDealStats";

const signal = () => AbortSignal.timeout(30_000);

describe("currency across business workflows", () => {
  it("round-trips large foreign amounts through the input boundary and storage", async () => {
    await withTestDb(async (db) => {
      await db
        .insert(settings)
        .values({
          id: true,
          baseCurrency: "USD",
          defaultVisibilityLevels: { deal: "all", person: "all", organization: "all" },
        });
      const user = await seedUser(db, { isAdmin: true });
      const { pipeline, stages } = await seedPipelineWithStages(db, ["Qualified"]);
      const stage = stages[0];
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
      const amount = "9999999999999.1234";
      const created = await createDeal(
        db,
        session,
        {
          title: "Large IRR",
          value: amount,
          currency: "IRR",
          pipelineId: pipeline.id,
          stageId: stage.id,
        },
        signal(),
      );
      expect(created.ok).toBe(true);
      if (created.ok) expect(created.value.value).toBe(amount);
    });
  });

  it("never merges currencies in goal progress, daily series, or report averages", async () => {
    await withTestDb(async (db) => {
      await db
        .insert(settings)
        .values({
          id: true,
          baseCurrency: "USD",
          defaultVisibilityLevels: { deal: "all", person: "all", organization: "all" },
        });
      const user = await seedUser(db, { isAdmin: true });
      const actor = toActor(user);
      const { pipeline, stages } = await seedPipelineWithStages(db, ["Qualified"]);
      const stage = stages[0];
      expect(stage).toBeDefined();
      if (stage === undefined) return;
      await db.insert(deals).values(
        [
          { title: "First KWD", value: "0.001", currency: "KWD" },
          { title: "Second KWD", value: "0.002", currency: "KWD" },
          { title: "USD", value: "900", currency: "USD" },
        ].map((row) => ({
          ...row,
          pipelineId: pipeline.id,
          stageId: stage.id,
          ownerId: user.id,
          visibilityLevel: "all" as const,
          status: "won" as const,
          createdAt: new Date("2026-10-10T12:00:00Z"),
          wonTime: new Date("2026-10-10T12:00:00Z"),
        })),
      );
      const common = {
        subject: "deal" as const,
        action: "won" as const,
        assigneeKind: "company" as const,
        assigneeId: null,
        pipelineId: pipeline.id,
        activityTypeId: null,
        interval: "monthly" as const,
        startsOn: "2026-10-01",
        endsOn: null,
      };
      const moneyGoal = await createGoal(
        db,
        { ...common, metric: "value", target: "0.010", currency: "KWD" },
        signal(),
      );
      const countGoal = await createGoal(db, { ...common, metric: "count", target: "3" }, signal());
      const period = { start: "2026-10-01", end: "2026-10-31" };
      expect(await goalActual(db, actor, moneyGoal, period, signal())).toBe("0.003");
      expect(await goalActual(db, actor, countGoal, period, signal())).toBe("3");
      const series = await goalSeries(db, actor, moneyGoal, period, "2026-10-10", signal());
      expect(series.at(-1)?.actual).toBe("0.003");
      const filters = {
        pipelineId: pipeline.id,
        owners: { everyone: true as const },
        from: period.start,
        to: period.end,
        currency: "KWD",
      };
      const report = await dealPerformance(db, actor, filters, signal());
      expect(report.won.count).toBe(2);
      expect(report.won.value).toBe("0.003");
      const averages = await wonDealStats(db, actor, { ...filters, currency: "USD" }, signal());
      expect(Number(averages.avgValue)).toBe(900);
    });
  });

  it("preserves the native unit during duplication and conversion back to a lead", async () => {
    await withTestDb(async (db) => {
      await db
        .insert(settings)
        .values({
          id: true,
          baseCurrency: "USD",
          defaultVisibilityLevels: { deal: "all", person: "all", organization: "all" },
        });
      const user = await seedUser(db, { isAdmin: true });
      const actor = toActor(user);
      const { pipeline, stages } = await seedPipelineWithStages(db, ["Qualified"]);
      const stage = stages[0];
      if (stage === undefined) return;
      const [source] = await db
        .insert(deals)
        .values({
          title: "IRR source",
          value: "250000",
          currency: "IRR",
          pipelineId: pipeline.id,
          stageId: stage.id,
          ownerId: user.id,
          visibilityLevel: "all",
        })
        .returning();
      expect(source).toBeDefined();
      if (source === undefined) return;
      const duplicate = await duplicateDeal(db, actor, { dealId: source.id }, signal());
      expect(duplicate.ok).toBe(true);
      if (!duplicate.ok) return;
      const [copy] = await db.select().from(deals).where(eq(deals.id, duplicate.value.id));
      expect(copy?.currency).toBe("IRR");
      expect(copy?.value).toBe("250000.00");
      const converted = await convertDealToLead(
        db,
        actor,
        { dealId: source.id, expectedUpdatedAt: source.updatedAt.toISOString() },
        signal(),
      );
      expect(converted.ok).toBe(true);
      if (!converted.ok) return;
      const [lead] = await db.select().from(leads).where(eq(leads.id, converted.value.leadId));
      expect(lead?.currency).toBe("IRR");
      expect(lead?.value).toBe("250000.00");
    });
  });
});
