import { and, eq, exists, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { inventoryQualityTargets } from "../../quality/schema";
import { returnReceipts } from "../../returns/schema";
import { outstandingSubcontractQuantity } from "../../subcontract/custodyBalance";
import { inventorySubcontractDispatches } from "../../subcontract/schema";
import {
  inventoryStockInstallations,
  inventoryStockPositions,
  inventoryStockTransferLines,
  inventoryStockTransfers,
} from "../../warehouse/schema";
import { inventoryEngineeringHolds } from "./schema";

/** Warehouse commands also run through historical-schema upgrade probes. */
export async function isEngineeringControlledPosition(
  tx: Db,
  position: { id: string; state: string },
) {
  if (position.state !== "hold") return false;
  const presence = await tx.execute<{ enabled: boolean }>(sql`
    SELECT to_regclass('public.inventory_engineering_holds') IS NOT NULL AS enabled
  `);
  if (presence.rows[0]?.enabled !== true) return false;
  const hold = inventoryEngineeringHolds;
  const [active] = await tx
    .select({ id: hold.id })
    .from(hold)
    .where(and(eq(hold.positionId, position.id), isNull(hold.releaseEventId)));
  return active !== undefined;
}

/** The caller has already pinned a completed native production output for each position. */
export async function readDispositionCustodyBlocks(tx: Db, positionIds: string[]) {
  if (positionIds.length === 0) return new Set<string>();
  const position = inventoryStockPositions;
  const installation = inventoryStockInstallations;
  const transfer = inventoryStockTransfers;
  const line = inventoryStockTransferLines;
  const quality = inventoryQualityTargets;
  const disposition = returnReceipts;
  const dispatch = inventorySubcontractDispatches;
  const one = { one: sql`1` };
  const installed = tx
    .select(one)
    .from(installation)
    .where(
      and(
        isNull(installation.removedEventId),
        or(
          eq(installation.assemblyPositionId, position.id),
          eq(installation.componentPositionId, position.id),
        ),
      ),
    );
  const inTransfer = tx
    .select(one)
    .from(line)
    .innerJoin(transfer, eq(transfer.id, line.transferId))
    .where(
      and(
        eq(line.sourcePositionId, position.id),
        inArray(transfer.status, ["draft", "in_transit"]),
      ),
    );
  const inspecting = tx
    .select(one)
    .from(quality)
    .where(and(eq(quality.positionId, position.id), ne(quality.status, "passed")));
  const returning = tx
    .select(one)
    .from(disposition)
    .where(
      and(
        eq(disposition.positionId, position.id),
        inArray(disposition.physical, ["quarantine", "repair"]),
      ),
    );
  const subcontracted = tx
    .select(one)
    .from(dispatch)
    .where(and(eq(dispatch.vendorPositionId, position.id), gt(outstandingSubcontractQuantity, 0)));
  const blocked = await tx
    .select({ id: position.id })
    .from(position)
    .where(
      and(
        inArray(position.id, positionIds),
        or(
          exists(installed),
          exists(inTransfer),
          exists(inspecting),
          exists(returning),
          exists(subcontracted),
        ),
      ),
    );
  return new Set(blocked.map(({ id }) => id));
}
