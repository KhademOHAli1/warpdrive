import { type SQL, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { users } from "@/db/schema/identity";
import { directoryLocations, directorySites } from "@/features/locations/schema";
import { inventoryPartFamilies, inventoryPartProfiles } from "../../catalog/schema";
import { inventoryItems } from "../../schema";
import type { WarehouseAccess } from "../access";
import { inventoryStockTransferLines, inventoryStockTransfers } from "../schema";
import type { WarehouseTransferRow, WarehouseTransfersQuery } from "./readContracts";
import { containsText, isoTimestamp, manageableSite, readableTransfer } from "./readSql";

function transferSearch(query: string) {
  const header = containsText(
    sql`concat_ws(' ', transfer.id::text, transfer.reason, actor.name,
    source_site.name, source_site.code, source_location.name, source_location.code,
    destination_site.name, destination_site.code, destination_location.name, destination_location.code)`,
    query,
  );
  const line = containsText(
    sql`concat_ws(' ', search_item.sku, search_item.name,
    search_item.revision, search_family.code, search_line.lot, search_line.serial)`,
    query,
  );
  return sql`(${header} OR EXISTS (
    SELECT 1 FROM ${inventoryStockTransferLines} AS search_line
    INNER JOIN ${inventoryItems} AS search_item ON search_item.id = search_line.item_id
    LEFT JOIN ${inventoryPartProfiles} AS search_profile ON search_profile.item_id = search_item.id
    LEFT JOIN ${inventoryPartFamilies} AS search_family ON search_family.id = search_profile.family_id
    WHERE search_line.transfer_id = transfer.id AND ${line}
  ))`;
}

function transferFilters(
  access: WarehouseAccess,
  { itemId, siteId, locationId, status, search, cursor }: WarehouseTransfersQuery,
): SQL {
  const conditions = [
    readableTransfer(
      access,
      sql`transfer.id`,
      sql`transfer.source_site_id`,
      sql`transfer.destination_site_id`,
    ),
  ];
  if (itemId !== undefined) {
    conditions.push(sql`EXISTS (
      SELECT 1 FROM ${inventoryStockTransferLines} AS selected
      WHERE selected.transfer_id = transfer.id AND selected.item_id = ${itemId}::uuid
    )`);
  }
  if (status !== undefined) conditions.push(sql`transfer.status = ${status}`);
  if (siteId !== undefined) {
    conditions.push(
      sql`${siteId}::uuid IN (transfer.source_site_id, transfer.destination_site_id)`,
    );
  }
  if (locationId !== undefined) {
    conditions.push(sql`${locationId}::uuid IN (
      transfer.source_location_id, transfer.destination_location_id
    )`);
  }
  if (cursor !== undefined) {
    conditions.push(sql`(transfer.created_at, transfer.id) < (
      ${cursor.createdAt}::timestamptz, ${cursor.id}::uuid
    )`);
  }
  const term = search?.trim();
  if (term !== undefined && term !== "") conditions.push(transferSearch(term));
  return sql.join(conditions, sql` AND `);
}

function projectedLines() {
  return sql`(
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', line.id, 'itemId', line.item_id, 'code', coalesce(family.code, item.sku),
      'name', item.name, 'revision', item.revision, 'sourcePositionId', line.source_position_id,
      'lot', line.lot, 'serial', line.serial, 'quantity', line.quantity, 'received', line.received
    ) ORDER BY coalesce(family.code, item.sku), item.revision, line.id), '[]'::jsonb)
    FROM ${inventoryStockTransferLines} AS line
    INNER JOIN ${inventoryItems} AS item ON item.id = line.item_id
    LEFT JOIN ${inventoryPartProfiles} AS profile ON profile.item_id = item.id
    LEFT JOIN ${inventoryPartFamilies} AS family ON family.id = profile.family_id
    WHERE line.transfer_id = transfer.id
  )`;
}

export async function projectTransfers(
  tx: Db,
  access: WarehouseAccess,
  query: WarehouseTransfersQuery,
) {
  const limit = query.limit ?? 40;
  // Header and lines come from the same statement snapshot, including partial receipts.
  const rows = await tx.execute<WarehouseTransferRow>(sql`
    SELECT transfer.id, transfer.status, transfer.version, transfer.reason, actor.name AS "actorName",
      transfer.source_site_id AS "sourceSiteId", source_site.name AS "sourceSiteName",
      transfer.source_location_id AS "sourceLocationId", source_location.name AS "sourceLocationName",
      transfer.destination_site_id AS "destinationSiteId", destination_site.name AS "destinationSiteName",
      transfer.destination_location_id AS "destinationLocationId",
      destination_location.name AS "destinationLocationName",
      ${isoTimestamp(sql`transfer.created_at`)} AS "createdAt",
      ${isoTimestamp(sql`transfer.updated_at`)} AS "updatedAt",
      ${projectedLines()} AS lines,
      (${manageableSite(access, sql`transfer.source_site_id`)}
        AND ${manageableSite(access, sql`transfer.destination_site_id`)}) AS "canManage"
    FROM ${inventoryStockTransfers} AS transfer
    INNER JOIN ${directorySites} AS source_site ON source_site.id = transfer.source_site_id
    INNER JOIN ${directorySites} AS destination_site ON destination_site.id = transfer.destination_site_id
    INNER JOIN ${directoryLocations} AS source_location ON source_location.id = transfer.source_location_id
    INNER JOIN ${directoryLocations} AS destination_location
      ON destination_location.id = transfer.destination_location_id
    LEFT JOIN ${users} AS actor ON actor.id = transfer.created_by
    WHERE ${transferFilters(access, query)}
    ORDER BY transfer.created_at DESC, transfer.id DESC
    LIMIT ${limit + 1}
  `);
  const page = rows.rows.slice(0, limit);
  const last = rows.rows.length > limit ? page.at(-1) : undefined;
  return {
    rows: page,
    nextCursor: last === undefined ? null : { id: last.id, createdAt: last.createdAt },
  };
}
