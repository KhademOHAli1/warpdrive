import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { deals, lostReasons } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { createDeal } from "./dealActions";
import { applyImportedDealHistory, buildImportedHistoryPatch } from "./importedHistory";
import { applyStatusTransition, type DealPatch } from "./statusTransition";

const signal = new AbortController().signal;
const NOW = new Date("2026-10-30T12:00:00.000Z");
const STATUSES = ["open", "won", "lost"] as const;
const pickedFields = (p: DealPatch) => ({
  status: p.status,
  wonTime: p.wonTime,
  lostTime: p.lostTime,
  lostReason: p.lostReason,
});

it.each(STATUSES)("sets and clears the same fields as dealUpdate for status %s", (status) => {
  const expected: DealPatch = {};
  applyStatusTransition(expected, status, "Too pricey", NOW);
  const { patch } = buildImportedHistoryPatch(
    { status, lostReason: "Too pricey", wonTime: NOW.toISOString(), lostTime: NOW.toISOString() },
    new Date("2030-01-01T00:00:00.000Z"),
  );
  expect(pickedFields(patch)).toEqual(pickedFields(expected));
});

it("infers a missing won time from createdAt and warns", () => {
  const { patch, warnings } = buildImportedHistoryPatch(
    { status: "won", createdAt: "2026-01-02T00:00:00.000Z" },
    NOW,
  );
  expect(patch.wonTime).toEqual(new Date("2026-01-02T00:00:00.000Z"));
  expect(warnings).toEqual([{ field: "wonTime", message: expect.any(String) }]);
});

it("infers a missing lost time from the import time when there is no createdAt", () => {
  const { patch, warnings } = buildImportedHistoryPatch({ status: "lost" }, NOW);
  expect(patch.lostTime).toEqual(NOW);
  expect(warnings).toHaveLength(1);
});

it("does not warn when the times are given", () => {
  const { warnings } = buildImportedHistoryPatch(
    { status: "won", wonTime: "2026-03-01T00:00:00.000Z" },
    NOW,
  );
  expect(warnings).toEqual([]);
});

it("writes created_at, stage_entered_at, status and reason id onto the deal", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const p = await seedPipelineWithStages(db, ["A"]);
    const stage = p.stages[0];
    if (stage === undefined) throw new Error("no stage");
    const created = await createDeal(
      db,
      {
        userId: user.id,
        isAdmin: true,
        isActive: true,
        sessionLive: true,
        visibilityGroupIds: [],
        managedUserIds: [],
        primaryVisibilityGroupId: null,
        flags: {},
      },
      { title: "T", pipelineId: p.pipeline.id, stageId: stage.id },
      signal,
    );
    if (created.ok === false) throw new Error("create failed");
    await db.insert(lostReasons).values({ name: "Too Pricey" });
    const warnings = await applyImportedDealHistory(
      db,
      created.value.id,
      {
        status: "lost",
        lostReason: "too pricey",
        lostTime: "2026-02-01T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      signal,
    );
    expect(warnings).toEqual([]);
    const [row] = await db.select().from(deals).where(eq(deals.id, created.value.id));
    expect(row?.createdAt).toEqual(new Date("2026-01-01T00:00:00.000Z"));
    expect(row?.stageEnteredAt).toEqual(new Date("2026-01-01T00:00:00.000Z"));
    expect(row?.status).toBe("lost");
    expect(row?.lostTime).toEqual(new Date("2026-02-01T00:00:00.000Z"));
    expect(row?.lostReason).toBe("too pricey");
    expect(row?.lostReasonId).not.toBeNull();
  });
});
