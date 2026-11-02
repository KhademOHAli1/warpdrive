// Integration tests for changeStage. Real Postgres via Testcontainers, no DB mocking.
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { dealMovedChannel } from "@/constants/boardChannels";
import { changeLogs, channelVersions, deals } from "@/db/schema";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import type { PermSetUser } from "@/features/permissions/effective";
import { makeTestDb } from "@/test/db";
import { changeStage } from "./changeStage";

let h: Awaited<ReturnType<typeof makeTestDb>>;

beforeAll(async () => {
  h = await makeTestDb();
}, 60_000);

afterAll(async () => {
  await h.close();
});

function makeActor(userId: string): PermSetUser {
  return { id: userId, type: "admin", isActive: true, groupIds: new Set(), flags: new Set() };
}

async function seedDeal(pipelineId: string, stageId: string, ownerId: string, boardPosition = "0") {
  const [deal] = await h.db
    .insert(deals)
    .values({ title: "Deal", pipelineId, stageId, ownerId, visibilityLevel: "all", boardPosition })
    .returning();
  if (deal === undefined) throw new Error("deal insert returned undefined");
  return deal;
}

async function stageMutationSnapshot(dealId: string, pipelineId: string) {
  const [row] = await h.db.select().from(deals).where(eq(deals.id, dealId));
  const audit = await h.db
    .select()
    .from(changeLogs)
    .where(eq(changeLogs.entityId, dealId))
    .orderBy(changeLogs.id);
  const channel = await h.db
    .select()
    .from(channelVersions)
    .where(eq(channelVersions.channel, dealMovedChannel(pipelineId)));
  return { row, audit, channel };
}

it("appends the deal to the bottom of a stage that already holds two deals", async () => {
  const u = await seedUser(h.db);
  const p = await seedPipelineWithStages(h.db, ["A", "B"]);
  const [s0, s1] = [p.stages[0]!, p.stages[1]!];

  await seedDeal(p.pipeline.id, s1.id, u.id, "1");
  await seedDeal(p.pipeline.id, s1.id, u.id, "2");
  const deal = await seedDeal(p.pipeline.id, s0.id, u.id, "5");

  const r = await changeStage(
    h.db,
    makeActor(u.id),
    {
      dealId: deal.id,
      toStageId: s1.id,
      expectedWriteVersion: deal.writeVersion,
      expectedUpdatedAt: deal.updatedAt.toISOString(),
    },
    new AbortController().signal,
  );

  expect(r.ok).toBe(true);
  if (r.ok === false) return;
  expect(r.value.stageId).toBe(s1.id);
  // Appended: strictly greater than the existing max (2) so it sorts last.
  expect(Number(r.value.boardPosition)).toBeGreaterThan(2);
  expect(r.value.stageEnteredAt.getTime()).toBeGreaterThanOrEqual(deal.stageEnteredAt.getTime());
});

it("writes a stageId changelog row on a stage change", async () => {
  const u = await seedUser(h.db);
  const p = await seedPipelineWithStages(h.db, ["A", "B"]);
  const [s0, s1] = [p.stages[0]!, p.stages[1]!];
  const deal = await seedDeal(p.pipeline.id, s0.id, u.id);

  const r = await changeStage(
    h.db,
    makeActor(u.id),
    {
      dealId: deal.id,
      toStageId: s1.id,
      expectedWriteVersion: deal.writeVersion,
      expectedUpdatedAt: deal.updatedAt.toISOString(),
    },
    new AbortController().signal,
  );
  expect(r.ok).toBe(true);

  const logs = await h.db
    .select()
    .from(changeLogs)
    .where(and(eq(changeLogs.entityId, deal.id), eq(changeLogs.field, "stageId")));
  expect(logs.length).toBe(1);
  expect(logs[0]?.oldValue).toBe(s0.id);
  expect(logs[0]?.newValue).toBe(s1.id);
});

it("rejects a stage from a different pipeline with E_DEAL_003", async () => {
  const u = await seedUser(h.db);
  const pA = await seedPipelineWithStages(h.db, ["A"]);
  const pB = await seedPipelineWithStages(h.db, ["B"]);
  const deal = await seedDeal(pA.pipeline.id, pA.stages[0]!.id, u.id);

  const r = await changeStage(
    h.db,
    makeActor(u.id),
    {
      dealId: deal.id,
      toStageId: pB.stages[0]!.id,
      expectedWriteVersion: deal.writeVersion,
      expectedUpdatedAt: deal.updatedAt.toISOString(),
    },
    new AbortController().signal,
  );

  expect(r.ok).toBe(false);
  if (r.ok === true) return;
  expect(r.error.id).toBe("E_DEAL_003");
});

it("returns E_DEAL_002 and leaves the deal unchanged when expectedWriteVersion is stale", async () => {
  const u = await seedUser(h.db);
  const p = await seedPipelineWithStages(h.db, ["A", "B"]);
  const [s0, s1] = [p.stages[0]!, p.stages[1]!];
  const deal = await seedDeal(p.pipeline.id, s0.id, u.id);

  const r = await changeStage(
    h.db,
    makeActor(u.id),
    {
      dealId: deal.id,
      toStageId: s1.id,
      expectedWriteVersion: "00000000-0000-4000-8000-000000000001",
      expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
    },
    new AbortController().signal,
  );

  expect(r.ok).toBe(false);
  if (r.ok === true) return;
  expect(r.error.id).toBe("E_DEAL_002");

  const [row] = await h.db.select().from(deals).where(eq(deals.id, deal.id));
  expect(row?.stageId).toBe(s0.id);
});

it("acknowledges a fresh current-stage selection without reordering or any mutation", async () => {
  const u = await seedUser(h.db);
  const p = await seedPipelineWithStages(h.db, ["A"]);
  const stage = p.stages[0]!;
  const deal = await seedDeal(p.pipeline.id, stage.id, u.id, "2");
  await seedDeal(p.pipeline.id, stage.id, u.id, "10");
  const before = await stageMutationSnapshot(deal.id, p.pipeline.id);

  const result = await changeStage(
    h.db,
    makeActor(u.id),
    { dealId: deal.id, toStageId: stage.id, expectedWriteVersion: deal.writeVersion },
    AbortSignal.timeout(5000),
  );

  expect(result.ok).toBe(true);
  if (!result.ok) throw result.error;
  expect(result.value).toEqual(before.row);
  expect(result.value.boardPosition).toBe("2");
  expect(result.value.writeVersion).toBe(deal.writeVersion);
  expect(await stageMutationSnapshot(deal.id, p.pipeline.id)).toEqual(before);
});

it("rejects a stale current-stage selection without acknowledging or changing the winner", async () => {
  const u = await seedUser(h.db);
  const p = await seedPipelineWithStages(h.db, ["A"]);
  const stage = p.stages[0]!;
  const deal = await seedDeal(p.pipeline.id, stage.id, u.id, "2");
  await h.db.update(deals).set({ title: "Concurrent winner" }).where(eq(deals.id, deal.id));
  const winner = await stageMutationSnapshot(deal.id, p.pipeline.id);
  expect(winner.row?.writeVersion).not.toBe(deal.writeVersion);

  const result = await changeStage(
    h.db,
    makeActor(u.id),
    { dealId: deal.id, toStageId: stage.id, expectedWriteVersion: deal.writeVersion },
    AbortSignal.timeout(5000),
  );

  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("stale current-stage selection was acknowledged");
  expect(result.error.id).toBe("E_DEAL_002");
  expect(await stageMutationSnapshot(deal.id, p.pipeline.id)).toEqual(winner);
});
