import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { inventoryPartProfiles } from "../catalog/schema";
import { InventoryDomainError } from "../errors";
import {
  type ApprovedBomLine,
  inventoryBuildReleases,
  inventoryProductReleases,
} from "../releases/schema";

export async function requireLegacyBuildMaterials(tx: Db, bom: ApprovedBomLine[]) {
  const specified = bom.flatMap(({ itemId, spec }) =>
    spec === undefined ? [] : [{ itemId, spec }],
  );
  if (specified.length === 0) return;
  if (
    specified.some(({ spec }) => spec.childReleaseId !== null || spec.optional || spec.consumable)
  ) {
    throw new InventoryDomainError(
      "This BOM needs release-aware build execution. Review its material requirements in BOM planning.",
    );
  }
  const rows = await tx
    .select({ itemId: inventoryPartProfiles.itemId, unit: inventoryPartProfiles.unit })
    .from(inventoryPartProfiles)
    .where(
      inArray(
        inventoryPartProfiles.itemId,
        specified.map(({ itemId }) => itemId),
      ),
    );
  const units = new Map(rows.map(({ itemId, unit }) => [itemId, unit]));
  if (specified.some(({ itemId, spec }) => (units.get(itemId) ?? "each") !== spec.stockUnit)) {
    throw new InventoryDomainError(
      "A material's current stock unit differs from the approved manufacturing BOM.",
    );
  }
}

export async function requirePinnedLegacyBuildMaterials(tx: Db, orderId: string) {
  const [release] = await tx
    .select({
      bom: inventoryProductReleases.bom,
      qualityPlanVersionId: inventoryProductReleases.qualityPlanVersionId,
    })
    .from(inventoryBuildReleases)
    .innerJoin(
      inventoryProductReleases,
      eq(inventoryProductReleases.id, inventoryBuildReleases.releaseId),
    )
    .where(eq(inventoryBuildReleases.orderId, orderId));
  if (release !== undefined) {
    requireUngatedLegacyRelease(release.qualityPlanVersionId);
    await requireLegacyBuildMaterials(tx, release.bom);
  }
}

export function requireUngatedLegacyRelease(qualityPlanVersionId: string | null) {
  if (qualityPlanVersionId !== null) {
    throw new InventoryDomainError(
      "Plan a serialized production build and pass its tests before allocating this stock to the order.",
    );
  }
}
