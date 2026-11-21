import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { directoryLocations, directorySites } from "@/features/locations/schema";
import { inventoryPartFamilies, inventoryPartProfiles } from "../../catalog/schema";
import { inventoryItems } from "../../schema";
import type { WarehouseAccess } from "../access";
import {
  inventoryStockEvents,
  inventoryStockInstallations,
  inventoryStockLocationPolicies,
  inventoryStockPositions,
} from "../schema";
import type {
  WarehouseInstallationRow,
  WarehouseInstallationsQuery,
  WarehouseInstallationsResult,
} from "./readContracts";
import { isoTimestamp, manageableSite, readableSite } from "./readSql";
import { readWithWarehouseScope } from "./reads";

async function projectInstallations(
  tx: Db,
  access: WarehouseAccess,
  { assemblyPositionId }: WarehouseInstallationsQuery,
) {
  const result = await tx.execute<{
    canManage: boolean;
    complete: boolean;
    installation: WarehouseInstallationRow | null;
  }>(
    sql`
      SELECT coalesce((
        ${manageableSite(access, sql`assembly.site_id`)}
        AND assembly.on_hand = 1 AND assembly.reserved = 0
        AND assembly.state = 'available' AND assembly.owner_organization_id IS NULL
        AND NOT site.archived AND NOT location.archived
        AND coalesce(policy.kind, 'storage') = 'storage'
      ), FALSE) AS "canManage",
      bool_and(coalesce(component.visible, TRUE)) OVER () AS complete,
      CASE WHEN component.visible THEN component.summary END AS installation
      FROM ${inventoryStockPositions} AS assembly
      INNER JOIN ${directorySites} AS site ON site.id = assembly.site_id
      INNER JOIN ${directoryLocations} AS location ON location.id = assembly.location_id
      LEFT JOIN ${inventoryStockLocationPolicies} AS policy ON policy.location_id = location.id
      LEFT JOIN ${inventoryPartProfiles} AS profile ON profile.item_id = assembly.item_id
      LEFT JOIN LATERAL (
        SELECT relation.id, event.created_at AS installed_at,
          (${access.isAdmin} OR part.visibility IS DISTINCT FROM 'admin') AS visible,
          jsonb_build_object(
            'id', relation.id, 'componentItemId', position.item_id,
            'componentCode', coalesce(family.code, item.sku), 'componentName', item.name,
            'componentRevision', item.revision, 'lot', position.lot, 'serial', position.serial,
            'expiryDate', position.expiry_date, 'quantity', relation.quantity,
            'installedAt', ${isoTimestamp(sql`event.created_at`)}
          ) AS summary
        FROM ${inventoryStockInstallations} AS relation
        INNER JOIN ${inventoryStockPositions} AS position ON position.id = relation.component_position_id
        INNER JOIN ${inventoryItems} AS item ON item.id = position.item_id
        INNER JOIN ${inventoryStockEvents} AS event ON event.id = relation.installed_event_id
        LEFT JOIN ${inventoryPartProfiles} AS part ON part.item_id = item.id
        LEFT JOIN ${inventoryPartFamilies} AS family ON family.id = part.family_id
        WHERE relation.assembly_position_id = assembly.id AND relation.removed_event_id IS NULL
      ) AS component ON TRUE
      WHERE assembly.id = ${assemblyPositionId}::uuid AND assembly.serial IS NOT NULL
        AND ${readableSite(access, sql`assembly.site_id`)}
        AND (${access.isAdmin} OR profile.visibility IS DISTINCT FROM 'admin')
      ORDER BY component.installed_at, component.id
    `,
  );
  const [first] = result.rows;
  if (first === undefined) return null;
  const rows = result.rows.flatMap(({ installation }) =>
    installation === null ? [] : [installation],
  );
  return {
    rows,
    canManage: first.canManage,
    canDisassemble: first.canManage && first.complete && rows.length > 0,
  };
}

export async function readWarehouseInstallations(
  db: Db,
  who: NativeSessionRef,
  query: WarehouseInstallationsQuery,
  signal: AbortSignal,
): Promise<WarehouseInstallationsResult> {
  const result = await readWithWarehouseScope(db, who, signal, (tx, access) =>
    projectInstallations(tx, access, query),
  );
  return result.ok && result.value !== null
    ? { ok: true, value: result.value }
    : { ok: false, error: "unavailable" };
}
