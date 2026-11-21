import { isDeepStrictEqual } from "node:util";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { InventoryDomainError } from "../errors";
import type { QualityPlanVersion, QualityStepDraft } from "./contracts";
import { inventoryQualityPlanVersions } from "./planSchema";

const planView = {
  id: inventoryQualityPlanVersions.id,
  name: inventoryQualityPlanVersions.name,
  version: inventoryQualityPlanVersions.version,
  steps: inventoryQualityPlanVersions.steps,
};

export function readQualityPlanVersions(tx: Db, itemId: string): Promise<QualityPlanVersion[]> {
  return tx
    .select(planView)
    .from(inventoryQualityPlanVersions)
    .where(eq(inventoryQualityPlanVersions.itemId, itemId))
    .orderBy(desc(inventoryQualityPlanVersions.version));
}

export async function requireQualityPlanVersion(tx: Db, itemId: string, planVersionId: string) {
  const [plan] = await tx
    .select()
    .from(inventoryQualityPlanVersions)
    .where(
      and(
        eq(inventoryQualityPlanVersions.id, planVersionId),
        eq(inventoryQualityPlanVersions.itemId, itemId),
      ),
    );
  if (plan === undefined) throw new InventoryDomainError("Choose a test plan for this product.");
  return plan;
}

/** Appends against the product row lock held by the engineering release command. */
export async function createQualityPlanVersion(
  tx: Db,
  actorId: string,
  command: { itemId: string; requestId: string; name: string; steps: QualityStepDraft[] },
) {
  const { itemId, requestId, name, steps } = command;
  const [prior] = await tx
    .select({ version: inventoryQualityPlanVersions.version })
    .from(inventoryQualityPlanVersions)
    .where(eq(inventoryQualityPlanVersions.itemId, itemId))
    .orderBy(desc(inventoryQualityPlanVersions.version))
    .limit(1);
  const [created] = await tx
    .insert(inventoryQualityPlanVersions)
    .values({
      itemId,
      requestId,
      name,
      steps,
      version: (prior?.version ?? 0) + 1,
      createdBy: actorId,
    })
    .onConflictDoNothing({
      target: [inventoryQualityPlanVersions.createdBy, inventoryQualityPlanVersions.requestId],
    })
    .returning({ planVersionId: inventoryQualityPlanVersions.id });
  if (created !== undefined) return created;
  const [replay] = await tx
    .select()
    .from(inventoryQualityPlanVersions)
    .where(
      and(
        eq(inventoryQualityPlanVersions.createdBy, actorId),
        eq(inventoryQualityPlanVersions.requestId, requestId),
      ),
    );
  if (
    replay?.itemId !== itemId ||
    replay.name !== name ||
    !isDeepStrictEqual(replay.steps, steps)
  ) {
    throw new InventoryDomainError("This request already saved a different test plan.");
  }
  return { planVersionId: replay.id };
}
