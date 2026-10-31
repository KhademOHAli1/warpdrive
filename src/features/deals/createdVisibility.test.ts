import { expect, test } from "vitest";
import { deals, leads } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { isLeadVisibleToSession } from "@/features/leads/createdVisibility";
import { isDealVisibleToSession } from "./createdVisibility";

const signal = new AbortController().signal;

function session(userId: string) {
  return {
    userId,
    isAdmin: false,
    isActive: true,
    sessionLive: true,
    visibilityGroupIds: [] as string[],
    managedUserIds: [] as string[],
    primaryVisibilityGroupId: null,
    flags: {} as Record<string, boolean>,
  };
}

test("an owner-level deal is visible to its owner and hidden from another user", async () => {
  await withTestDb(async (db) => {
    const owner = await seedUser(db);
    const other = await seedUser(db);
    const p = await seedPipelineWithStages(db, ["S"]);
    const [deal] = await db
      .insert(deals)
      .values({
        title: "D",
        pipelineId: p.pipeline.id,
        stageId: p.stages[0]!.id,
        ownerId: owner.id,
        visibilityLevel: "owner",
      })
      .returning();
    expect(await isDealVisibleToSession(db, session(owner.id), deal!.id, signal)).toBe(true);
    expect(await isDealVisibleToSession(db, session(other.id), deal!.id, signal)).toBe(false);
  });
});

test("an owner-level lead is visible to its owner and hidden from another user", async () => {
  await withTestDb(async (db) => {
    const owner = await seedUser(db);
    const other = await seedUser(db);
    const [lead] = await db
      .insert(leads)
      .values({ title: "L", ownerId: owner.id, visibilityLevel: "owner" })
      .returning();
    expect(await isLeadVisibleToSession(db, session(owner.id), lead!.id, signal)).toBe(true);
    expect(await isLeadVisibleToSession(db, session(other.id), lead!.id, signal)).toBe(false);
  });
});
