import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { deals, importExternalIds } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { lockImportMutation } from "@/features/import/importLock";
import { personRow, seedBatchWithRows } from "@/features/import/pipedriveImport.testHelpers";
import type { PermSetUser } from "@/features/permissions/effective";
import { mergeDeals } from "./mergeDeals";

function actor(userId: string): PermSetUser {
  return {
    id: userId,
    type: "regular",
    isActive: true,
    groupIds: new Set(),
    flags: new Set(["deal.edit_own" as const]),
  };
}

it("fails and keeps the source mapping when the target is soft-deleted while the merge waits for the import lock", async () => {
  await withTestDb(async (db) => {
    const u = await seedUser(db);
    const p = await seedPipelineWithStages(db, ["A", "B"]);
    const [target, source] = await db
      .insert(deals)
      .values([
        {
          title: "Target",
          pipelineId: p.pipeline.id,
          stageId: p.stages[0]!.id,
          ownerId: u.id,
          visibilityLevel: "all" as const,
        },
        {
          title: "Source",
          pipelineId: p.pipeline.id,
          stageId: p.stages[1]!.id,
          ownerId: u.id,
          visibilityLevel: "all" as const,
        },
      ])
      .returning();
    if (target === undefined || source === undefined) throw new Error("seed failed");
    const { batchId } = await seedBatchWithRows(db, u.id, {
      source: "pipedrive",
      target: "person",
      rows: [personRow("1", "Ann")],
    });
    await db.insert(importExternalIds).values([
      { source: "pipedrive", entity: "deal", externalId: "t", localId: target.id, batchId },
      { source: "pipedrive", entity: "deal", externalId: "s", localId: source.id, batchId },
    ]);

    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked: () => void = () => undefined;
    const lockTaken = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const undoLike = db.transaction(async (tx) => {
      await lockImportMutation(tx, new AbortController().signal);
      locked();
      await held;
      await tx
        .update(deals)
        .set({ deletedAt: new Date(), updatedAt: target.updatedAt })
        .where(eq(deals.id, target.id));
    });
    await lockTaken;

    const merging = mergeDeals(
      db,
      actor(u.id),
      {
        targetDealId: target.id,
        sourceDealId: source.id,
        expectedTargetUpdatedAt: target.updatedAt.toISOString(),
        expectedSourceUpdatedAt: source.updatedAt.toISOString(),
      },
      new AbortController().signal,
    );
    await new Promise((r) => setTimeout(r, 300));
    release();
    await undoLike;
    const r = await merging;

    expect(r.ok).toBe(false);
    const [sourceAfter] = await db.select().from(deals).where(eq(deals.id, source.id));
    expect(sourceAfter?.deletedAt).toBeNull();
    const maps = await db.select().from(importExternalIds);
    expect(Object.fromEntries(maps.map((m) => [m.externalId, m.localId]))).toEqual({
      t: target.id,
      s: source.id,
    });
  });
});
