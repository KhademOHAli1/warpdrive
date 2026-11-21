import { and, eq, gt, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { inventoryProductionBuilds, inventoryProductionOutputs } from "../production/buildSchema";
import {
  hasSubcontractSchema,
  outstandingSubcontractQuantity,
} from "../subcontract/custodyBalance";
import { inventorySubcontractDispatches, inventorySubcontracts } from "../subcontract/schema";
import type { inventoryStockPositions } from "./schema";

const dispatches = inventorySubcontractDispatches;
const subcontracts = inventorySubcontracts;
const builds = inventoryProductionBuilds;
const outputs = inventoryProductionOutputs;

function unsettledCustody() {
  return gt(outstandingSubcontractQuantity, 0);
}

/** Generic stock commands must leave subcontract custody and held output to Production. */
export async function isSubcontractControlledPosition(
  tx: Db,
  { id, buildOutputId }: Pick<typeof inventoryStockPositions.$inferSelect, "id" | "buildOutputId">,
) {
  if (!(await hasSubcontractSchema(tx))) return false;
  if (buildOutputId !== null) {
    const [pending] = await tx
      .select({ id: outputs.id })
      .from(outputs)
      .where(and(eq(outputs.id, buildOutputId), eq(outputs.status, "wip")))
      .limit(1);
    if (pending !== undefined) return true;
  }
  const [active] = await tx
    .select({ id: dispatches.id })
    .from(dispatches)
    .where(and(eq(dispatches.vendorPositionId, id), unsettledCustody()))
    .limit(1);
  return active !== undefined;
}

/** Call under the directory write fence so a dispatch cannot race location changes. */
export async function hasSubcontractLocationUse(tx: Db, siteId: string, locationId: string) {
  if (!(await hasSubcontractSchema(tx))) return false;
  const [active] = await tx
    .select({ buildId: subcontracts.buildId })
    .from(subcontracts)
    .innerJoin(builds, eq(builds.id, subcontracts.buildId))
    .where(
      and(
        eq(subcontracts.siteId, siteId),
        eq(subcontracts.supplierBinId, locationId),
        sql`${builds.status} NOT IN ('closed', 'cancelled')`,
      ),
    )
    .limit(1);
  if (active !== undefined) return true;
  const [custody] = await tx
    .select({ id: dispatches.id })
    .from(dispatches)
    .innerJoin(subcontracts, eq(subcontracts.buildId, dispatches.buildId))
    .where(
      and(
        eq(subcontracts.siteId, siteId),
        or(eq(subcontracts.supplierBinId, locationId), eq(dispatches.sourceLocationId, locationId)),
        unsettledCustody(),
      ),
    )
    .limit(1);
  return custody !== undefined;
}
