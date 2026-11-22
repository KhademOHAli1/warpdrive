import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/db/schema/identity";
import { directoryLocations } from "@/features/locations/schema";
import { assetCustodians, assetCustodyHistory } from "../../custody/schema";
import { assetKitCheckouts } from "../../kits/schema";
import { assetRecords } from "../../schema";
import { assetBookingEvents, assetBookings } from "../schema";
import type {
  BookingHandoverAllocation,
  BookingHandoverNotice,
  BookingHandoverReceipt,
} from "./contracts";
import type { HandoverInspectionHold } from "./fixtureState";

const instant = (name: string) => timestamp(name, { withTimezone: true });

export const assetBookingHandovers = pgTable(
  "asset_booking_handovers",
  {
    bookingId: uuid("booking_id").primaryKey(),
    siteId: uuid("site_id").notNull(),
    approvedVersion: integer("approved_version").notNull(),
    version: integer("version").notNull(),
    pickupClosed: boolean("pickup_closed").notNull(),
    custodianId: uuid("custodian_id"),
    custodianName: text("custodian_name"),
  },
  (row) => [
    unique("asset_booking_handovers_site_booking_key").on(row.siteId, row.bookingId),
    foreignKey({
      name: "asset_booking_handovers_booking_fk",
      columns: [row.siteId, row.bookingId],
      foreignColumns: [assetBookings.siteId, assetBookings.id],
    }),
    foreignKey({
      name: "asset_booking_handovers_approval_fk",
      columns: [row.bookingId, row.approvedVersion],
      foreignColumns: [assetBookingEvents.bookingId, assetBookingEvents.version],
    }),
    foreignKey({
      name: "asset_booking_handovers_custodian_fk",
      columns: [row.siteId, row.custodianId],
      foreignColumns: [assetCustodians.siteId, assetCustodians.id],
    }),
    check(
      "asset_booking_handovers_versions_check",
      sql`${row.version} > 0 AND ${row.approvedVersion} > 0`,
    ),
    check(
      "asset_booking_handovers_custodian_check",
      sql`(${row.custodianId} IS NULL) = (${row.custodianName} IS NULL)`,
    ),
  ],
);

type AllocationSnapshot = Pick<
  BookingHandoverAllocation,
  "lineKey" | "name" | "code" | "serial" | "sourceBin" | "members"
>;

export const assetBookingHandoverAllocations = pgTable(
  "asset_booking_handover_allocations",
  {
    id: uuid("id").primaryKey(),
    bookingId: uuid("booking_id").notNull(),
    siteId: uuid("site_id").notNull(),
    kind: text("kind").$type<BookingHandoverAllocation["kind"]>().notNull(),
    assetId: uuid("asset_id"),
    kitId: uuid("kit_id"),
    checkoutId: uuid("checkout_id"),
    holdingId: uuid("holding_id"),
    custodyEventId: uuid("custody_event_id").references(() => assetCustodyHistory.id),
    sourceLocationId: uuid("source_location_id"),
    issued: integer("issued").notNull(),
    outstanding: integer("outstanding").notNull(),
    snapshot: jsonb("snapshot").$type<AllocationSnapshot>().notNull(),
  },
  (row) => [
    unique("asset_booking_handover_allocations_scope_key").on(row.siteId, row.bookingId, row.id),
    unique("asset_booking_handover_allocations_holding_key").on(row.holdingId),
    unique("asset_booking_handover_allocations_checkout_key").on(row.checkoutId),
    uniqueIndex("asset_booking_handover_allocations_serial_key")
      .on(row.bookingId, row.assetId)
      .where(sql`${row.kind} = 'asset'`),
    uniqueIndex("asset_booking_handover_allocations_kit_key")
      .on(row.bookingId, row.kitId)
      .where(sql`${row.kind} = 'kit'`),
    index("asset_booking_handover_allocations_site_held_idx")
      .on(row.siteId)
      .where(sql`${row.outstanding} > 0`),
    foreignKey({
      name: "asset_booking_handover_allocations_booking_fk",
      columns: [row.siteId, row.bookingId],
      foreignColumns: [assetBookingHandovers.siteId, assetBookingHandovers.bookingId],
    }),
    foreignKey({
      name: "asset_booking_handover_allocations_asset_fk",
      columns: [row.siteId, row.assetId],
      foreignColumns: [assetRecords.siteId, assetRecords.id],
    }),
    foreignKey({
      name: "asset_booking_handover_allocations_kit_checkout_fk",
      columns: [row.siteId, row.kitId, row.checkoutId],
      foreignColumns: [assetKitCheckouts.siteId, assetKitCheckouts.kitId, assetKitCheckouts.id],
    }),
    foreignKey({
      name: "asset_booking_handover_allocations_location_fk",
      columns: [row.siteId, row.sourceLocationId],
      foreignColumns: [directoryLocations.siteId, directoryLocations.id],
    }),
    check(
      "asset_booking_handover_allocations_quantity_check",
      sql`${row.issued} BETWEEN 1 AND 1000000 AND ${row.outstanding} BETWEEN 0 AND ${row.issued}
        AND (${row.kind} NOT IN ('asset','kit') OR ${row.issued} = 1)`,
    ),
    check(
      "asset_booking_handover_allocations_type_check",
      sql`
      (${row.kind} = 'kit' AND ${row.kitId} IS NOT NULL AND ${row.checkoutId} IS NOT NULL
         AND ${row.assetId} IS NULL AND ${row.holdingId} IS NULL AND ${row.custodyEventId} IS NULL)
      OR (${row.kind} IN ('asset', 'returnable_pool') AND ${row.assetId} IS NOT NULL
         AND ${row.holdingId} IS NOT NULL AND ${row.custodyEventId} IS NOT NULL
         AND ${row.kitId} IS NULL AND ${row.checkoutId} IS NULL)
      OR (${row.kind} = 'consumable_pool' AND ${row.assetId} IS NOT NULL AND ${row.outstanding} = 0
         AND ${row.holdingId} IS NULL AND ${row.custodyEventId} IS NULL AND ${row.kitId} IS NULL AND ${row.checkoutId} IS NULL)`,
    ),
    check(
      "asset_booking_handover_allocations_snapshot_check",
      sql`jsonb_typeof(${row.snapshot}) = 'object'`,
    ),
  ],
);

export const assetBookingHandoverReceipts = pgTable(
  "asset_booking_handover_receipts",
  {
    id: uuid("id").primaryKey(),
    bookingId: uuid("booking_id").notNull(),
    siteId: uuid("site_id").notNull(),
    version: integer("version").notNull(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    requestId: uuid("request_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
    at: instant("at").notNull(),
    snapshot: jsonb("snapshot").$type<BookingHandoverReceipt>().notNull(),
  },
  (row) => [
    unique("asset_booking_handover_receipts_actor_request_key").on(row.actorId, row.requestId),
    unique("asset_booking_handover_receipts_booking_version_key").on(row.bookingId, row.version),
    unique("asset_booking_handover_receipts_booking_scope_key").on(
      row.siteId,
      row.bookingId,
      row.id,
    ),
    foreignKey({
      name: "asset_booking_handover_receipts_booking_fk",
      columns: [row.siteId, row.bookingId],
      foreignColumns: [assetBookingHandovers.siteId, assetBookingHandovers.bookingId],
    }),
    check(
      "asset_booking_handover_receipts_snapshot_check",
      sql`${row.version} > 0 AND ${row.fingerprint} ~ '^[0-9a-f]{64}$' AND jsonb_typeof(${row.snapshot}) = 'object'`,
    ),
  ],
);

export const assetBookingHandoverInspections = pgTable(
  "asset_booking_handover_inspections",
  {
    receiptId: uuid("receipt_id").notNull(),
    allocationId: uuid("allocation_id").notNull(),
    bookingId: uuid("booking_id").notNull(),
    siteId: uuid("site_id").notNull(),
    targetId: uuid("target_id").notNull(),
    locationId: uuid("location_id").notNull(),
    quantity: integer("quantity").notNull(),
    condition: text("condition").$type<HandoverInspectionHold["condition"]>().notNull(),
  },
  (row) => [
    primaryKey({ columns: [row.receiptId, row.allocationId] }),
    index("asset_booking_handover_inspections_site_idx").on(
      row.siteId,
      row.targetId,
      row.locationId,
    ),
    foreignKey({
      name: "asset_booking_handover_inspections_allocation_fk",
      columns: [row.siteId, row.bookingId, row.allocationId],
      foreignColumns: [
        assetBookingHandoverAllocations.siteId,
        assetBookingHandoverAllocations.bookingId,
        assetBookingHandoverAllocations.id,
      ],
    }),
    foreignKey({
      name: "asset_booking_handover_inspections_receipt_fk",
      columns: [row.siteId, row.bookingId, row.receiptId],
      foreignColumns: [
        assetBookingHandoverReceipts.siteId,
        assetBookingHandoverReceipts.bookingId,
        assetBookingHandoverReceipts.id,
      ],
    }),
    foreignKey({
      name: "asset_booking_handover_inspections_asset_fk",
      columns: [row.siteId, row.targetId],
      foreignColumns: [assetRecords.siteId, assetRecords.id],
    }),
    foreignKey({
      name: "asset_booking_handover_inspections_location_fk",
      columns: [row.siteId, row.locationId],
      foreignColumns: [directoryLocations.siteId, directoryLocations.id],
    }),
    check(
      "asset_booking_handover_inspections_value_check",
      sql`${row.quantity} BETWEEN 1 AND 1000000 AND ${row.condition} IN ('damaged','needs_inspection')`,
    ),
  ],
);

export const assetBookingHandoverNotices = pgTable(
  "asset_booking_handover_notices",
  {
    bookingId: uuid("booking_id").notNull(),
    siteId: uuid("site_id").notNull(),
    dueAt: instant("due_at").notNull(),
    kind: text("kind").$type<BookingHandoverNotice["kind"]>().notNull(),
    at: instant("at").notNull(),
  },
  (row) => [
    primaryKey({ columns: [row.bookingId, row.dueAt, row.kind] }),
    index("asset_booking_handover_notices_site_idx").on(row.siteId, row.at),
    foreignKey({
      name: "asset_booking_handover_notices_booking_fk",
      columns: [row.siteId, row.bookingId],
      foreignColumns: [assetBookings.siteId, assetBookings.id],
    }),
    check(
      "asset_booking_handover_notices_value_check",
      sql`${row.kind} IN ('overdue','expired') AND ${row.at} >= ${row.dueAt}`,
    ),
  ],
);

export const assetBookingHandoverNoticeEpoch = pgTable(
  "asset_booking_handover_notice_epoch",
  { id: boolean("id").primaryKey(), activeAt: instant("active_at").notNull() },
  (row) => [check("asset_booking_handover_notice_epoch_singleton", sql`${row.id}`)],
);
