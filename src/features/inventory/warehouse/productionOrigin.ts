import { and, eq, gt, inArray, isNull, notExists, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { inventoryProductionBuilds, inventoryProductionOutputs } from "../production/buildSchema";
import { inventoryStockInstallations, inventoryStockPositions } from "./schema";

/** The callers scope the site, current catalog unit and eligible physical balances. */
export async function readEligibleBuildOrigins(tx: Db, siteId: string, itemIds: string[]) {
  if (itemIds.length === 0) return new Map<string, never>();
  const stock = inventoryStockPositions;
  const output = inventoryProductionOutputs;
  const build = inventoryProductionBuilds;
  const installed = inventoryStockInstallations;
  const rows = await tx
    .select({ positionId: stock.id, releaseId: output.releaseId, stockUnit: build.stockUnit })
    .from(stock)
    .innerJoin(output, eq(stock.buildOutputId, output.id))
    .innerJoin(build, eq(output.buildId, build.id))
    .where(
      and(
        eq(stock.siteId, siteId),
        inArray(stock.itemId, itemIds),
        gt(stock.onHand, 0),
        eq(output.status, "completed"),
        notExists(
          tx
            .select({ one: sql`1` })
            .from(installed)
            .where(
              and(eq(installed.assemblyPositionId, stock.id), isNull(installed.removedEventId)),
            ),
        ),
      ),
    );
  return new Map(rows.map(({ positionId, ...origin }) => [positionId, origin]));
}
