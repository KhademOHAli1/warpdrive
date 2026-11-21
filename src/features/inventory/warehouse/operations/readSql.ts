import { inArray, type SQL, sql } from "drizzle-orm";
import { inventoryPartProfiles } from "../../catalog/schema";
import type { WarehouseAccess } from "../access";
import { inventoryStockTransferLines } from "../schema";

export function readableSite(access: WarehouseAccess, site: SQL): SQL {
  return access.isAdmin
    ? sql`TRUE`
    : inArray(
        site,
        access.sites.map(({ id }) => id),
      );
}

export function manageableSite(access: WarehouseAccess, site: SQL): SQL {
  return access.isAdmin
    ? sql`TRUE`
    : inArray(
        site,
        access.sites.filter(({ canManage }) => canManage).map(({ id }) => id),
      );
}

export function readableTransfer(access: WarehouseAccess, id: SQL, source: SQL, destination: SQL) {
  if (access.isAdmin) return sql`TRUE`;
  return sql`(
    ${readableSite(access, source)} AND ${readableSite(access, destination)}
    AND NOT EXISTS (
      SELECT 1 FROM ${inventoryStockTransferLines} AS hidden_line
      INNER JOIN ${inventoryPartProfiles} AS hidden_profile
        ON hidden_profile.item_id = hidden_line.item_id
      WHERE hidden_line.transfer_id = ${id} AND hidden_profile.visibility = 'admin'
    )
  )`;
}

export function isoTimestamp(column: SQL): SQL {
  return sql`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

export function containsText(document: SQL, query: string): SQL {
  return sql`strpos(lower(${document}), lower(${query})) > 0`;
}
