import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import type { Goal } from "@/db/schema/goals";
import {
  seedActivityType,
  seedDeal,
  seedPipeline,
  seedUser,
  toActor,
} from "@/features/stats/statsTestHelpers";
import { makeTestDb, type TestDb } from "@/test/db";
import { goalProgress } from "./goalProgress";

let h: TestDb;
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});

async function seedGoal(values: Partial<typeof schema.goals.$inferInsert>): Promise<Goal> {
  const [g] = await h.db
    .insert(schema.goals)
    .values({
      subject: "deal",
      action: "won",
      metric: "value",
      assigneeKind: "company",
      interval: "monthly",
      target: "1000.00",
      startsOn: "2026-01-01",
      ...values,
    })
    .returning();
  if (g === undefined) throw new Error("no goal row");
  return g;
}

describe("goalProgress", () => {
  it("neutralises missing eligible deal values without contaminating scope, currency, period or count goals", async () => {
    const alice = await seedUser(h);
    const bob = await seedUser(h);
    const { pipeline, stages } = await seedPipeline(h);
    const stage = stages[0];
    if (stage === undefined) throw new Error("no stage");
    for (const row of [
      {
        title: "Known zero",
        value: "0",
        currency: "EUR",
        ownerId: alice.id,
        visibilityLevel: "all" as const,
        lostTime: new Date("2026-03-05T12:00:00Z"),
      },
      {
        title: "Hidden missing value",
        value: null,
        currency: "EUR",
        ownerId: bob.id,
        visibilityLevel: "owner" as const,
        lostTime: new Date("2026-03-05T12:00:00Z"),
      },
      {
        title: "Other currency missing value",
        value: null,
        currency: "USD",
        ownerId: alice.id,
        visibilityLevel: "all" as const,
        lostTime: new Date("2026-03-05T12:00:00Z"),
      },
      {
        title: "Other period missing value",
        value: null,
        currency: "EUR",
        ownerId: alice.id,
        visibilityLevel: "all" as const,
        lostTime: new Date("2026-04-05T12:00:00Z"),
      },
    ])
      await seedDeal(h, { ...row, status: "lost", pipelineId: pipeline.id, stageId: stage.id });
    const goal = await seedGoal({
      subject: "deal",
      action: "lost",
      metric: "value",
      currency: "EUR",
      pipelineId: pipeline.id,
      target: "0",
    });
    const control = await goalProgress(
      h.db,
      toActor(alice),
      goal,
      "2026-03-15",
      new AbortController().signal,
    );
    expect(control).toMatchObject({ dataState: "available", attainment: 1 });
    expect(Number(control?.actual)).toBe(0);
    await seedDeal(h, {
      title: "Eligible missing value",
      value: null,
      currency: "EUR",
      status: "lost",
      ownerId: alice.id,
      visibilityLevel: "all",
      lostTime: new Date("2026-03-05T12:00:00Z"),
      pipelineId: pipeline.id,
      stageId: stage.id,
    });
    const incomplete = await goalProgress(
      h.db,
      toActor(alice),
      goal,
      "2026-03-15",
      new AbortController().signal,
    );
    expect(incomplete?.attainment).toBeNull();
    expect(incomplete).toMatchObject({
      dataState: "incomplete",
      missingValueCount: 1,
      missingMeasurementDateCount: 0,
      pace: null,
    });
    expect(Number(incomplete?.actual)).toBe(0);
    const countGoal = await seedGoal({
      subject: "deal",
      action: "lost",
      metric: "count",
      pipelineId: pipeline.id,
      target: "3",
    });
    expect(
      await goalProgress(
        h.db,
        toActor(alice),
        countGoal,
        "2026-03-15",
        new AbortController().signal,
      ),
    ).toMatchObject({ actual: "3", dataState: "available", missingValueCount: 0, attainment: 1 });
  });
  it("keeps a legacy zero-loss ceiling neutral for a visible undated loss without exposing hidden losses", async () => {
    const alice = await seedUser(h);
    const bob = await seedUser(h);
    const { pipeline, stages } = await seedPipeline(h);
    const stage = stages[0];
    if (stage === undefined) throw new Error("no stage");
    await seedDeal(h, {
      title: "Hidden undated loss",
      status: "lost",
      lostTime: null,
      ownerId: bob.id,
      visibilityLevel: "owner",
      pipelineId: pipeline.id,
      stageId: stage.id,
      currency: "EUR",
    });
    await seedDeal(h, {
      title: "Legitimately open",
      status: "open",
      ownerId: alice.id,
      visibilityLevel: "all",
      pipelineId: pipeline.id,
      stageId: stage.id,
    });
    const goal = await seedGoal({
      subject: "deal",
      action: "lost",
      metric: "count",
      pipelineId: pipeline.id,
      target: "0",
    });
    const available = await goalProgress(
      h.db,
      toActor(alice),
      goal,
      "2026-03-15",
      new AbortController().signal,
    );
    expect(available).toMatchObject({ actual: "0", attainment: 1 });
    await seedDeal(h, {
      title: "Visible undated loss",
      status: "lost",
      lostTime: null,
      ownerId: alice.id,
      visibilityLevel: "all",
      pipelineId: pipeline.id,
      stageId: stage.id,
      currency: "EUR",
    });
    const incomplete = await goalProgress(
      h.db,
      toActor(alice),
      goal,
      "2026-03-15",
      new AbortController().signal,
    );
    expect(incomplete?.attainment).toBeNull();
    expect(incomplete).toMatchObject({
      actual: "0",
      attainment: null,
      pace: null,
      dataState: "incomplete",
      missingMeasurementDateCount: 1,
    });
    expect(available).toMatchObject({ dataState: "available", missingMeasurementDateCount: 0 });
    await seedDeal(h, {
      title: "Different-currency undated loss",
      status: "lost",
      lostTime: null,
      ownerId: alice.id,
      visibilityLevel: "all",
      pipelineId: pipeline.id,
      stageId: stage.id,
      currency: "USD",
    });
    const moneyGoal = await seedGoal({
      subject: "deal",
      action: "lost",
      metric: "value",
      pipelineId: pipeline.id,
      currency: "EUR",
      target: "0",
    });
    expect(
      await goalProgress(
        h.db,
        toActor(alice),
        moneyGoal,
        "2026-03-15",
        new AbortController().signal,
      ),
    ).toMatchObject({ dataState: "incomplete", missingMeasurementDateCount: 1, attainment: null });
  });
  it("keeps known activity actuals while neutralising undated completions under parent and assignee visibility", async () => {
    const alice = await seedUser(h);
    const bob = await seedUser(h);
    const type = await seedActivityType(h);
    const { pipeline, stages } = await seedPipeline(h);
    const stage = stages[0];
    if (stage === undefined) throw new Error("no stage");
    const visible = await seedDeal(h, {
      title: "Visible parent",
      ownerId: alice.id,
      visibilityLevel: "all",
      pipelineId: pipeline.id,
      stageId: stage.id,
    });
    const hidden = await seedDeal(h, {
      title: "Hidden parent",
      ownerId: bob.id,
      visibilityLevel: "owner",
      pipelineId: pipeline.id,
      stageId: stage.id,
    });
    await h.db.insert(schema.activities).values([
      {
        subject: "Known completion",
        done: true,
        doneAt: new Date("2026-03-05T12:00:00Z"),
        typeId: type.id,
        ownerId: alice.id,
        assigneeId: alice.id,
        dealId: visible.id,
      },
      {
        subject: "Visible undated completion",
        done: true,
        doneAt: null,
        typeId: type.id,
        ownerId: alice.id,
        assigneeId: alice.id,
        dealId: visible.id,
      },
      {
        subject: "Not completed",
        done: false,
        doneAt: null,
        typeId: type.id,
        ownerId: alice.id,
        assigneeId: alice.id,
        dealId: visible.id,
      },
      {
        subject: "Hidden undated completion",
        done: true,
        doneAt: null,
        typeId: type.id,
        ownerId: bob.id,
        assigneeId: alice.id,
        dealId: hidden.id,
      },
      {
        subject: "Other assignee",
        done: true,
        doneAt: null,
        typeId: type.id,
        ownerId: bob.id,
        assigneeId: bob.id,
        dealId: visible.id,
      },
    ]);
    const goal = await seedGoal({
      subject: "activity",
      action: "completed",
      metric: "count",
      assigneeKind: "user",
      assigneeId: alice.id,
      pipelineId: pipeline.id,
      activityTypeId: type.id,
      target: "1",
    });
    const incomplete = await goalProgress(
      h.db,
      toActor(alice),
      goal,
      "2026-03-15",
      new AbortController().signal,
    );
    expect(incomplete?.attainment).toBeNull();
    expect(incomplete).toMatchObject({
      actual: "1",
      dataState: "incomplete",
      missingMeasurementDateCount: 1,
      attainment: null,
      pace: null,
    });
  });
  it("totals the value won by the assignee inside the current period", async () => {
    const user = await seedUser(h, { isAdmin: true });
    const { pipeline, stages } = await seedPipeline(h);
    const stage = stages[0];
    if (stage === undefined) throw new Error("no stage");
    for (const [value, wonOn] of [
      ["400.00", "2026-03-05"],
      ["100.00", "2026-03-20"],
      // Won in the next period, so it must not inflate March.
      ["9999.00", "2026-04-02"],
    ] as const) {
      await seedDeal(h, {
        title: `won ${value}`,
        status: "won",
        value,
        pipelineId: pipeline.id,
        stageId: stage.id,
        ownerId: user.id,
        visibilityLevel: "all",
        wonTime: new Date(`${wonOn}T12:00:00Z`),
      });
    }
    const goal = await seedGoal({ pipelineId: pipeline.id, target: "1000.00" });

    const p = await goalProgress(
      h.db,
      toActor(user),
      goal,
      "2026-03-15",
      new AbortController().signal,
    );
    expect(p?.periodStart).toBe("2026-03-01");
    expect(p?.periodEnd).toBe("2026-03-31");
    expect(Number(p?.actual)).toBe(500);
    expect(p?.attainment).toBeCloseTo(0.5, 5);
  });

  it("counts only the named user's deals for a user goal", async () => {
    const alice = await seedUser(h, { isAdmin: true });
    const bob = await seedUser(h, { isAdmin: true });
    const { pipeline, stages } = await seedPipeline(h);
    const stage = stages[0];
    if (stage === undefined) throw new Error("no stage");
    for (const owner of [alice, bob]) {
      await seedDeal(h, {
        title: `won by ${owner.id}`,
        status: "won",
        value: "100.00",
        pipelineId: pipeline.id,
        stageId: stage.id,
        ownerId: owner.id,
        visibilityLevel: "all",
        wonTime: new Date("2026-03-05T12:00:00Z"),
      });
    }
    const goal = await seedGoal({
      pipelineId: pipeline.id,
      assigneeKind: "user",
      assigneeId: alice.id,
      target: "100.00",
    });

    const p = await goalProgress(
      h.db,
      toActor(alice),
      goal,
      "2026-03-15",
      new AbortController().signal,
    );
    expect(Number(p?.actual)).toBe(100);
  });

  it("follows a team's current membership", async () => {
    const lead = await seedUser(h, { isAdmin: true });
    const member = await seedUser(h, { isAdmin: true });
    const outsider = await seedUser(h, { isAdmin: true });
    const [team] = await h.db
      .insert(schema.teams)
      .values({ name: `Team-${Date.now()}` })
      .returning();
    if (team === undefined) throw new Error("no team");
    await h.db.insert(schema.teamMembers).values([
      { teamId: team.id, userId: lead.id },
      { teamId: team.id, userId: member.id },
    ]);

    const { pipeline, stages } = await seedPipeline(h);
    const stage = stages[0];
    if (stage === undefined) throw new Error("no stage");
    for (const owner of [lead, member, outsider]) {
      await seedDeal(h, {
        title: `won by ${owner.id}`,
        status: "won",
        value: "50.00",
        pipelineId: pipeline.id,
        stageId: stage.id,
        ownerId: owner.id,
        visibilityLevel: "all",
        wonTime: new Date("2026-03-05T12:00:00Z"),
      });
    }
    const goal = await seedGoal({
      pipelineId: pipeline.id,
      assigneeKind: "team",
      assigneeId: team.id,
      target: "200.00",
    });

    const p = await goalProgress(
      h.db,
      toActor(lead),
      goal,
      "2026-03-15",
      new AbortController().signal,
    );
    expect(Number(p?.actual)).toBe(100);
  });

  it("counts completed activities of one type for an activity goal", async () => {
    const user = await seedUser(h, { isAdmin: true });
    const call = await seedActivityType(h, "Call");
    const lunch = await seedActivityType(h, "Lunch");
    const { pipeline, stages } = await seedPipeline(h);
    const stage = stages[0];
    if (stage === undefined) throw new Error("no stage");
    const deal = await seedDeal(h, {
      title: "d",
      status: "open",
      pipelineId: pipeline.id,
      stageId: stage.id,
      ownerId: user.id,
      visibilityLevel: "all",
    });
    await h.db.insert(schema.activities).values([
      {
        typeId: call.id,
        subject: "c1",
        done: true,
        doneAt: new Date("2026-03-05T12:00:00Z"),
        ownerId: user.id,
        assigneeId: user.id,
        dealId: deal.id,
      },
      {
        typeId: lunch.id,
        subject: "l1",
        done: true,
        doneAt: new Date("2026-03-05T12:00:00Z"),
        ownerId: user.id,
        assigneeId: user.id,
        dealId: deal.id,
      },
    ]);
    const goal = await seedGoal({
      pipelineId: pipeline.id,
      subject: "activity",
      action: "completed",
      metric: "count",
      activityTypeId: call.id,
      target: "10",
    });

    const p = await goalProgress(
      h.db,
      toActor(user),
      goal,
      "2026-03-15",
      new AbortController().signal,
    );
    expect(p?.actual).toBe("1");
  });

  it("is null before the goal has started", async () => {
    const user = await seedUser(h, { isAdmin: true });
    const goal = await seedGoal({ startsOn: "2026-06-01" });
    const p = await goalProgress(
      h.db,
      toActor(user),
      goal,
      "2026-05-01",
      new AbortController().signal,
    );
    expect(p).toBeNull();
  });

  it("reports pace against how much of the period has gone", async () => {
    const user = await seedUser(h, { isAdmin: true });
    const { pipeline, stages } = await seedPipeline(h);
    const stage = stages[0];
    if (stage === undefined) throw new Error("no stage");
    await seedDeal(h, {
      title: "half the target",
      status: "won",
      value: "500.00",
      pipelineId: pipeline.id,
      stageId: stage.id,
      ownerId: user.id,
      visibilityLevel: "all",
      wonTime: new Date("2026-03-02T12:00:00Z"),
    });
    const goal = await seedGoal({ pipelineId: pipeline.id, target: "1000.00" });

    // Day 5 of 31: half the target booked on a sixth of the month is well ahead.
    const p = await goalProgress(
      h.db,
      toActor(user),
      goal,
      "2026-03-05",
      new AbortController().signal,
    );
    expect(p?.pace ?? 0).toBeGreaterThan(1);
  });

  it("SECURITY: a deal the viewer cannot see never reaches the goal total", async () => {
    const alice = await seedUser(h);
    const bob = await seedUser(h);
    const { pipeline, stages } = await seedPipeline(h);
    const stage = stages[0];
    if (stage === undefined) throw new Error("no stage");
    await seedDeal(h, {
      title: "bob only",
      status: "won",
      value: "7777.00",
      pipelineId: pipeline.id,
      stageId: stage.id,
      ownerId: bob.id,
      visibilityLevel: "owner",
      wonTime: new Date("2026-03-05T12:00:00Z"),
    });
    const goal = await seedGoal({ pipelineId: pipeline.id, assigneeKind: "company" });

    const p = await goalProgress(
      h.db,
      toActor(alice),
      goal,
      "2026-03-15",
      new AbortController().signal,
    );
    expect(Number(p?.actual)).toBe(0);
  });
});
