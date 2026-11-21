import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { ProductionBuildRow } from "../production/buildSchema";
import type { inventoryProductionMaterials } from "../production/materialSchema";
import type { inventoryStockPositions } from "../warehouse/schema";
import {
  inventorySubcontractDispatches,
  inventorySubcontractMaterials,
  inventorySubcontracts,
} from "./schema";

type PositionIdentity = Pick<
  typeof inventoryStockPositions.$inferSelect,
  "itemId" | "buildOutputId" | "lot" | "serial" | "expiryDate" | "ownerOrganizationId"
>;

export function stockIdentity({
  itemId,
  buildOutputId,
  lot,
  serial,
  expiryDate,
  ownerOrganizationId,
}: PositionIdentity): PositionIdentity {
  return { itemId, buildOutputId, lot, serial, expiryDate, ownerOrganizationId };
}

export function sameStockIdentity(source: PositionIdentity, target: PositionIdentity) {
  return (
    source.itemId === target.itemId &&
    source.buildOutputId === target.buildOutputId &&
    source.lot === target.lot &&
    source.serial === target.serial &&
    source.expiryDate === target.expiryDate &&
    source.ownerOrganizationId === target.ownerOrganizationId
  );
}

export const outstandingSubcontractQuantity = sql<number>`
  ${inventorySubcontractDispatches.quantity} -
  ${inventorySubcontractDispatches.consumed} -
  ${inventorySubcontractDispatches.returned}
`;

export function remainingCustody({
  quantity,
  consumed,
  returned,
}: {
  quantity: number;
  consumed: number;
  returned: number;
}) {
  return quantity - consumed - returned;
}

export async function hasSubcontractSchema(tx: Db) {
  const result = await tx.execute<{ installed: boolean }>(
    sql`SELECT to_regclass('public.inventory_subcontract_dispatches') IS NOT NULL AS installed`,
  );
  return result.rows[0]?.installed === true;
}

export async function readSubcontractMaterialDemand(
  tx: Db,
  build: ProductionBuildRow,
  material: Pick<typeof inventoryProductionMaterials.$inferSelect, "id" | "perUnit">,
) {
  const originalDemand = material.perUnit * (build.quantity - build.completed - build.scrapped);
  if (!(await hasSubcontractSchema(tx))) return originalDemand;
  const dispatches = inventorySubcontractDispatches;
  const [row] = await tx
    .select({
      companyMaterialId: inventorySubcontractMaterials.materialId,
      outstanding: sql<number>`coalesce((
        SELECT sum(${outstandingSubcontractQuantity})::int
        FROM ${dispatches}
        WHERE ${dispatches.buildId} = ${build.id} AND ${dispatches.materialId} = ${material.id}
      ), 0)`,
    })
    .from(inventorySubcontracts)
    .leftJoin(
      inventorySubcontractMaterials,
      and(
        eq(inventorySubcontractMaterials.buildId, inventorySubcontracts.buildId),
        eq(inventorySubcontractMaterials.materialId, material.id),
      ),
    )
    .where(eq(inventorySubcontracts.buildId, build.id));
  if (row === undefined) return originalDemand;
  return row.companyMaterialId === null ? 0 : Math.max(0, originalDemand - row.outstanding);
}
