import { and, desc, eq, inArray } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { AssetsWorkspace } from "../../contracts";
import type { Booking } from "../contracts";
import type { BookingHandoverReceipt } from "./contracts";
import {
  createHandoverState,
  type HandoverAllocation,
  type HandoverSession,
  type HandoverState,
} from "./fixtureState";
import {
  assetBookingHandoverAllocations as allocations,
  assetBookingHandoverInspections as inspections,
  assetBookingHandoverReceipts as receipts,
  assetBookingHandovers as sessions,
} from "./schema";
import type { HandoverPhysicalEffect } from "./transitions";

function invariant(message: string): never {
  throw new AppError(ERROR_IDS.DB_INVARIANT, message);
}

function allocationDto(row: typeof allocations.$inferSelect): HandoverAllocation {
  const targetId = row.assetId ?? row.kitId;
  if (targetId === null) invariant("A booking allocation lost its equipment target");
  return {
    ...row.snapshot,
    id: row.id,
    targetId,
    kind: row.kind,
    sourceLocationId: row.sourceLocationId,
    issued: row.issued,
    outstanding: row.outstanding,
    holdingId: row.holdingId,
    checkoutId: row.checkoutId,
  };
}

export async function loadHandoverState(
  tx: Db,
  assets: AssetsWorkspace,
  siteIds: readonly string[],
  receiptBookingId?: string,
): Promise<HandoverState> {
  const empty = createHandoverState(assets);
  if (siteIds.length === 0) return empty;
  const rows = await tx.select().from(sessions).where(inArray(sessions.siteId, siteIds));
  const projected: Record<string, HandoverSession> = {};
  for (const row of rows) {
    const { custodianId, custodianName, version, pickupClosed } = row;
    projected[row.bookingId] = {
      version,
      pickupClosed,
      custodian:
        custodianId === null || custodianName === null
          ? null
          : { id: custodianId, name: custodianName },
      allocations: [],
      receipts: [],
    };
  }

  if (rows.length > 0) {
    const equipment = await tx
      .select()
      .from(allocations)
      .where(inArray(allocations.siteId, siteIds));
    for (const row of equipment) projected[row.bookingId]?.allocations.push(allocationDto(row));
  }

  if (receiptBookingId !== undefined && projected[receiptBookingId] !== undefined) {
    const history = await tx
      .select({ snapshot: receipts.snapshot })
      .from(receipts)
      .where(and(eq(receipts.bookingId, receiptBookingId), inArray(receipts.siteId, siteIds)))
      .orderBy(desc(receipts.version));
    projected[receiptBookingId].receipts = history.map(({ snapshot }) => snapshot);
  }

  const inspection = await tx
    .select({
      allocationId: inspections.allocationId,
      siteId: inspections.siteId,
      targetId: inspections.targetId,
      locationId: inspections.locationId,
      quantity: inspections.quantity,
      condition: inspections.condition,
    })
    .from(inspections)
    .where(inArray(inspections.siteId, siteIds));
  return { ...empty, sessions: projected, inspection };
}

export async function handoverReplay(tx: Db, actorId: string, requestId: string) {
  const [previous] = await tx
    .select({ bookingId: receipts.bookingId, fingerprint: receipts.fingerprint })
    .from(receipts)
    .where(and(eq(receipts.actorId, actorId), eq(receipts.requestId, requestId)));
  return previous;
}

async function persistSession(
  tx: Db,
  booking: Booking,
  before: HandoverSession | undefined,
  after: HandoverSession,
) {
  const update = {
    version: after.version,
    pickupClosed: after.pickupClosed,
    custodianId: after.custodian?.id ?? null,
    custodianName: after.custodian?.name ?? null,
  };
  if (before === undefined) {
    await tx.insert(sessions).values({
      ...update,
      siteId: booking.siteId,
      bookingId: booking.id,
      approvedVersion: booking.version,
    });
    return;
  }

  const [changed] = await tx
    .update(sessions)
    .set(update)
    .where(and(eq(sessions.bookingId, booking.id), eq(sessions.version, before.version)))
    .returning({ id: sessions.bookingId });
  if (changed === undefined) invariant("Booking handover changed while the register was locked");
}

function snapshot({ lineKey, name, code, serial, sourceBin, members }: HandoverAllocation) {
  return { lineKey, name, code, serial, sourceBin, members };
}

function pickupEventId(row: HandoverAllocation, effects: HandoverPhysicalEffect[]) {
  if (row.holdingId === null) return null;
  const step = effects.find(
    (effect) => effect.kind === "custody" && effect.allocationId === row.id,
  );
  const event = step?.after.custody.events.find(
    (entry) =>
      entry.holdingId === row.holdingId &&
      entry.assetId === row.targetId &&
      entry.action === "assign",
  );
  return event?.id ?? invariant("A handover pickup lost its source custody event");
}

async function persistAllocation(
  tx: Db,
  booking: Booking,
  row: HandoverAllocation,
  before: HandoverAllocation | undefined,
  effects: HandoverPhysicalEffect[],
) {
  const stored = { outstanding: row.outstanding, snapshot: snapshot(row) };
  if (before === undefined) {
    await tx.insert(allocations).values({
      ...stored,
      siteId: booking.siteId,
      bookingId: booking.id,
      id: row.id,
      kind: row.kind,
      assetId: row.kind === "kit" ? null : row.targetId,
      kitId: row.kind === "kit" ? row.targetId : null,
      checkoutId: row.checkoutId,
      holdingId: row.holdingId,
      custodyEventId: pickupEventId(row, effects),
      sourceLocationId: row.sourceLocationId,
      issued: row.issued,
    });
  } else if (before !== row) {
    await tx.update(allocations).set(stored).where(eq(allocations.id, row.id));
  }
}

type RequestIdentity = { id: string; actorId: string; fingerprint: string };
export async function persistHandover(
  tx: Db,
  booking: Booking,
  before: HandoverState,
  after: HandoverState,
  request: RequestIdentity,
  effects: HandoverPhysicalEffect[],
): Promise<BookingHandoverReceipt> {
  const next = after.sessions[booking.id];
  const receipt = next?.receipts[0];
  if (next === undefined || receipt === undefined)
    invariant("Booking handover did not record a receipt");
  const previous = before.sessions[booking.id];
  await persistSession(tx, booking, previous, next);
  const priorAllocations = new Map(previous?.allocations.map((row) => [row.id, row]));
  for (const row of next.allocations) {
    await persistAllocation(tx, booking, row, priorAllocations.get(row.id), effects);
  }

  await tx.insert(receipts).values({
    id: receipt.id,
    bookingId: booking.id,
    siteId: booking.siteId,
    version: next.version,
    actorId: request.actorId,
    requestId: request.id,
    fingerprint: request.fingerprint,
    at: new Date(receipt.at),
    snapshot: receipt,
  });
  const holds = after.inspection.slice(before.inspection.length);
  if (holds.length > 0) {
    await tx.insert(inspections).values(
      holds.map((hold) => ({
        ...hold,
        receiptId: receipt.id,
        bookingId: booking.id,
      })),
    );
  }
  return receipt;
}
