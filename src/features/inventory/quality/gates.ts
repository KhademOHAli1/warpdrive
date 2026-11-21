import { and, eq, ne, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { ProductionBuildRow } from "../production/buildSchema";
import { failProduction } from "../production/failure";
import { inventoryProductReleases } from "../releases/schema";
import type { inventoryStockPositions } from "../warehouse/schema";
import { inventoryQualityTargets } from "./schema";

export async function qualityPlanForBuild(tx: Db, build: Pick<ProductionBuildRow, "releaseId">) {
  const [release] = await tx
    .select({ planVersionId: inventoryProductReleases.qualityPlanVersionId })
    .from(inventoryProductReleases)
    .where(eq(inventoryProductReleases.id, build.releaseId));
  if (release === undefined) failProduction("state");
  return release.planVersionId;
}

/** Insert only after production consumes its inputs and credits the held serial. */
export async function registerQualityTarget(
  tx: Db,
  build: ProductionBuildRow,
  outputId: string,
  position: typeof inventoryStockPositions.$inferSelect,
  planVersionId: string,
) {
  if (position.serial === null || position.state !== "hold" || position.onHand !== 1) {
    failProduction("serial");
  }
  await tx.insert(inventoryQualityTargets).values({
    siteId: build.siteId,
    buildId: build.id,
    itemId: build.itemId,
    releaseId: build.releaseId,
    outputId,
    positionId: position.id,
    serial: position.serial,
    lot: position.lot,
    planVersionId,
  });
}

export async function hasPendingBuildInspection(tx: Db, buildId: string) {
  const [target] = await tx
    .select({ id: inventoryQualityTargets.id })
    .from(inventoryQualityTargets)
    .where(
      and(
        eq(inventoryQualityTargets.buildId, buildId),
        ne(inventoryQualityTargets.status, "passed"),
      ),
    )
    .limit(1);
  return target !== undefined;
}

export async function isQualityControlledPosition(
  tx: Db,
  {
    id,
    buildOutputId,
  }: {
    id: string;
    buildOutputId: string | null;
  },
) {
  if (buildOutputId === null) return false;
  // Warehouse upgrade probes also exercise older exact schemas through the same command helpers.
  const {
    rows: [presence],
  } = await tx.execute<{ enabled: boolean }>(sql`
    SELECT to_regclass('public.inventory_quality_targets') IS NOT NULL AS enabled
  `);
  if (presence?.enabled !== true) return false;
  const [target] = await tx
    .select({ id: inventoryQualityTargets.id })
    .from(inventoryQualityTargets)
    .where(
      and(eq(inventoryQualityTargets.positionId, id), ne(inventoryQualityTargets.status, "passed")),
    )
    .limit(1);
  return target !== undefined;
}
