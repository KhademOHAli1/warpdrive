import { type SQL, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { users } from "@/db/schema/identity";
import { directoryLocations, directorySites } from "@/features/locations/schema";
import { inventoryPartFamilies, inventoryPartProfiles } from "../../catalog/schema";
import { inventoryItems, inventoryMovements } from "../../schema";
import type { WarehouseAccess } from "../access";
import {
  inventoryStockEventDetails,
  inventoryStockEvents,
  inventoryStockInstallations,
  inventoryStockLocationPolicies,
  inventoryStockPositions,
  inventoryStockTransferLines,
  inventoryStockTransfers,
} from "../schema";
import type { WarehouseMovementHistoryQuery, WarehouseMovementRow } from "./readContracts";
import {
  containsText,
  isoTimestamp,
  manageableSite,
  readableSite,
  readableTransfer,
} from "./readSql";

const isStructuralEvent = sql`event.kind IN (
  'stock-split', 'stock-merge', 'component-install', 'component-remove', 'stock-disassemble'
)`;

function visibleStructureReference(access: WarehouseAccess) {
  if (access.isAdmin) return sql`TRUE`;
  return sql`NOT EXISTS (
    SELECT 1 FROM ${inventoryStockEvents} AS peer
    INNER JOIN ${inventoryStockEventDetails} AS peer_details ON peer_details.event_id = peer.id
    LEFT JOIN ${inventoryPartProfiles} AS peer_profile ON peer_profile.item_id = peer.item_id
    WHERE peer.actor_id = event.actor_id AND peer.request_id = event.request_id
      AND (peer_profile.visibility = 'admin' OR peer_details.site_id IS NULL
        OR NOT ${readableSite(access, sql`peer_details.site_id`)})
  )`;
}

function visibleTransferReference(access: WarehouseAccess) {
  return sql`details.transfer_id IS NULL OR (
    transfer.id IS NOT NULL
    AND ${readableTransfer(access, sql`transfer.id`, sql`transfer.source_site_id`, sql`transfer.destination_site_id`)}
  )`;
}

function reversibleCorrection(access: WarehouseAccess) {
  return sql`coalesce((
    event.kind = 'correction' AND event.on_hand_delta <> 0
    AND ${manageableSite(access, sql`details.site_id`)}
    AND NOT site.archived AND NOT location.archived
    AND coalesce(location_policy.kind, 'storage') <> 'structure'
    AND stock_position.site_id = details.site_id AND stock_position.location_id = details.location_id
    AND stock_position.on_hand = details.previous_on_hand + event.on_hand_delta
    AND details.previous_on_hand >= stock_position.reserved
    AND (stock_position.serial IS NOT NULL OR NOT coalesce((profile.flags->>'trackable')::boolean, FALSE)
      OR details.previous_on_hand <= stock_position.on_hand)
    AND (stock_position.serial IS NULL OR details.previous_on_hand <= 1)
    AND (details.previous_on_hand <> 0 OR NOT EXISTS (
      SELECT 1 FROM ${inventoryStockInstallations} AS installation
      WHERE installation.assembly_position_id = stock_position.id AND installation.removed_event_id IS NULL
    ))
    AND NOT EXISTS (
      SELECT 1 FROM ${inventoryStockEventDetails} AS reversal
      WHERE reversal.reverses_event_id = event.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM ${inventoryStockEvents} AS later
      INNER JOIN ${inventoryStockEventDetails} AS later_details ON later_details.event_id = later.id
      WHERE (later.position_id = event.position_id
        OR (later.source_position_id = event.position_id AND later.kind = 'state'))
        AND later_details.sequence > details.sequence AND later.on_hand_delta <> 0
    )
    AND (stock_position.serial IS NULL OR NOT EXISTS (
      SELECT 1 FROM ${inventoryStockTransferLines} AS pending_line
      INNER JOIN ${inventoryStockTransfers} AS pending ON pending.id = pending_line.transfer_id
      WHERE pending_line.source_position_id = stock_position.id AND pending.status = 'in_transit'
        AND pending_line.received < pending_line.quantity
    ))
  ), FALSE)`;
}

function eventRows(access: WarehouseAccess): SQL {
  const canSeeReference = visibleTransferReference(access);
  const canSeeStructure = visibleStructureReference(access);
  return sql`
    SELECT
      event.id, 'event'::text AS source, event.kind, event.created_at,
      event.item_id, coalesce(family.code, item.sku) AS code, item.name, item.revision,
      details.site_id, site.name AS site_name, details.location_id, location.name AS location_name,
      event.position_id, stock_position.lot, stock_position.serial, actor.name AS actor_name,
      CASE WHEN event.kind IN ('reconcile', 'state') THEN 0 ELSE event.on_hand_delta END AS on_hand_delta,
      event.reserved_delta, event.incoming_delta,
      CASE WHEN event.kind IN ('reconcile', 'state') THEN nullif(event.on_hand_delta, 0)
        WHEN event.kind IN ('production-accept', 'quality-release') THEN details.previous_on_hand END AS affected_quantity,
      event.previous_state, event.state, details.previous_on_hand,
      CASE WHEN (${canSeeReference}) AND (NOT (${isStructuralEvent}) OR (${canSeeStructure}))
        THEN details.reason END AS reason,
      CASE WHEN ${access.isAdmin} THEN event.order_id END AS order_id,
      event.incoming_id,
      CASE WHEN (${canSeeReference}) THEN details.transfer_id END AS transfer_id,
      CASE WHEN (${canSeeReference}) THEN details.transfer_line_id END AS transfer_line_id,
      CASE WHEN (${isStructuralEvent}) AND (${canSeeStructure}) THEN event.request_id END AS structure_operation_id,
      CASE WHEN event.kind IN ('stock-split', 'stock-merge', 'component-remove', 'production-dispatch', 'production-return')
        AND (${canSeeStructure}) AND ${readableSite(access, sql`origin_position.site_id`)}
        THEN event.source_position_id END AS source_position_id,
      details.reverses_event_id,
      ${reversibleCorrection(access)} AS can_reverse
    FROM ${inventoryStockEvents} AS event
    LEFT JOIN ${inventoryStockEventDetails} AS details ON details.event_id = event.id
    INNER JOIN ${inventoryItems} AS item ON item.id = event.item_id
    LEFT JOIN ${inventoryPartProfiles} AS profile ON profile.item_id = item.id
    LEFT JOIN ${inventoryPartFamilies} AS family ON family.id = profile.family_id
    LEFT JOIN ${inventoryStockPositions} AS stock_position ON stock_position.id = event.position_id
    LEFT JOIN ${inventoryStockPositions} AS origin_position ON origin_position.id = event.source_position_id
    LEFT JOIN ${directorySites} AS site ON site.id = details.site_id
    LEFT JOIN ${directoryLocations} AS location ON location.id = details.location_id
    LEFT JOIN ${inventoryStockLocationPolicies} AS location_policy
      ON location_policy.site_id = details.site_id AND location_policy.location_id = details.location_id
    LEFT JOIN ${inventoryStockTransfers} AS transfer ON transfer.id = details.transfer_id
    LEFT JOIN ${users} AS actor ON actor.id = event.actor_id
    WHERE ${readableSite(access, sql`details.site_id`)}
      AND (${access.isAdmin} OR profile.visibility IS DISTINCT FROM 'admin')
  `;
}

// Position events are the allocated part of the canonical delta. The remainder is the
// Unlocated movement, calculated across the entire ledger before any site filter.
function unlocatedRows(): SQL {
  return sql`
    SELECT
      movement.id, 'movement'::text AS source, movement.kind, movement.created_at,
      movement.item_id, coalesce(family.code, item.sku) AS code, item.name, item.revision,
      NULL::uuid AS site_id, NULL::text AS site_name,
      NULL::uuid AS location_id, NULL::text AS location_name,
      NULL::uuid AS position_id, NULL::text AS lot, NULL::text AS serial, actor.name AS actor_name,
      (movement.on_hand_delta - linked.on_hand)::int AS on_hand_delta,
      (movement.reserved_delta - linked.reserved)::int AS reserved_delta,
      0 AS incoming_delta, NULL::int AS affected_quantity, NULL::text AS previous_state,
      NULL::text AS state,
      NULL::int AS previous_on_hand, NULL::text AS reason,
      movement.order_id, NULL::uuid AS incoming_id, NULL::uuid AS transfer_id,
      NULL::uuid AS transfer_line_id, NULL::uuid AS structure_operation_id,
      NULL::uuid AS source_position_id, NULL::uuid AS reverses_event_id, FALSE AS can_reverse
    FROM ${inventoryMovements} AS movement
    INNER JOIN ${inventoryItems} AS item ON item.id = movement.item_id
    LEFT JOIN ${inventoryPartProfiles} AS profile ON profile.item_id = item.id
    LEFT JOIN ${inventoryPartFamilies} AS family ON family.id = profile.family_id
    LEFT JOIN ${users} AS actor ON actor.id = movement.actor_id
    CROSS JOIN LATERAL (
      SELECT count(*) AS event_count,
        coalesce(sum(event.on_hand_delta), 0) AS on_hand,
        coalesce(sum(event.reserved_delta), 0) AS reserved
      FROM ${inventoryStockEvents} AS event WHERE event.movement_id = movement.id
    ) AS linked
    WHERE linked.event_count = 0
      OR movement.on_hand_delta <> linked.on_hand OR movement.reserved_delta <> linked.reserved
  `;
}

function historyFilters({
  movementId,
  itemId,
  siteId,
  locationId,
  kind,
  from,
  to,
  cursor,
  search,
}: WarehouseMovementHistoryQuery): SQL {
  const conditions = [sql`TRUE`];
  if (movementId !== undefined) conditions.push(sql`id = ${movementId}::uuid`);
  if (itemId !== undefined) conditions.push(sql`item_id = ${itemId}::uuid`);
  if (siteId !== undefined) conditions.push(sql`site_id = ${siteId}::uuid`);
  if (locationId !== undefined) conditions.push(sql`location_id = ${locationId}::uuid`);
  if (kind !== undefined) conditions.push(sql`kind = ${kind}`);
  if (from !== undefined) {
    conditions.push(sql`created_at >= (${from}::date::timestamp AT TIME ZONE 'UTC')`);
  }
  if (to !== undefined) {
    conditions.push(sql`created_at < ((${to}::date + 1)::timestamp AT TIME ZONE 'UTC')`);
  }
  if (cursor !== undefined) {
    // Keep PostgreSQL's full timestamp precision for events that share a millisecond.
    conditions.push(sql`(created_at, id, source) < (
      ${cursor.createdAt}::timestamptz, ${cursor.id}::uuid, ${cursor.source}::text
    )`);
  }
  const term = search?.trim();
  if (term !== undefined && term !== "") {
    conditions.push(
      containsText(
        sql`concat_ws(' ', code, name, revision, lot, serial,
      site_name, location_name, actor_name, reason, transfer_id::text, order_id::text,
      structure_operation_id::text, position_id::text, source_position_id::text)`,
        term,
      ),
    );
  }
  return sql.join(conditions, sql` AND `);
}

export async function projectMovementHistory(
  tx: Db,
  access: WarehouseAccess,
  query: WarehouseMovementHistoryQuery,
) {
  const limit = query.limit ?? 40;
  const includeUnlocated =
    access.isAdmin && query.siteId === undefined && query.locationId === undefined;
  const rows = await tx.execute<WarehouseMovementRow>(sql`
    WITH history AS (
      ${eventRows(access)}
      ${includeUnlocated ? sql`UNION ALL ${unlocatedRows()}` : sql``}
    )
    SELECT id, source, kind, ${isoTimestamp(sql`created_at`)} AS "createdAt",
      item_id AS "itemId", code, name, revision, site_id AS "siteId", site_name AS "siteName",
      location_id AS "locationId", location_name AS "locationName", position_id AS "positionId",
      lot, serial, actor_name AS "actorName", on_hand_delta AS "onHandDelta",
      reserved_delta AS "reservedDelta", incoming_delta AS "incomingDelta",
      affected_quantity AS "affectedQuantity",
      previous_state AS "previousState", state, previous_on_hand AS "previousOnHand", reason,
      order_id AS "orderId", incoming_id AS "incomingId", transfer_id AS "transferId",
      transfer_line_id AS "transferLineId", structure_operation_id AS "structureOperationId",
      source_position_id AS "sourcePositionId", reverses_event_id AS "reversesEventId",
      can_reverse AS "canReverse"
    FROM history
    WHERE ${historyFilters(query)}
    ORDER BY created_at DESC, id DESC, source DESC
    LIMIT ${limit + 1}
  `);
  const page = rows.rows.slice(0, limit);
  const last = rows.rows.length > limit ? page.at(-1) : undefined;
  return {
    rows: page,
    nextCursor:
      last === undefined ? null : { id: last.id, createdAt: last.createdAt, source: last.source },
  };
}
