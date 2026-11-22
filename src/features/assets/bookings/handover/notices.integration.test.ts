import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { assert, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { actor } from "@/features/inventory/warehouse/operations/structures.test-helpers";
import { directorySites } from "@/features/locations/schema";
import { makeTestDb } from "@/test/db";
import { assetCustodians, assetCustodyHistory, assetCustodyHoldings } from "../../custody/schema";
import { assetEvents, assetRecords } from "../../schema";
import type { BookingEvent } from "../contracts";
import { assetBookingEvents, assetBookings } from "../schema";
import { readBookingHandoverNotices, recordBookingHandoverNotices } from "./notices";
import {
  assetBookingHandoverAllocations as allocations,
  assetBookingHandoverNoticeEpoch as epoch,
  assetBookingHandovers as handovers,
  assetBookingHandoverNotices as notices,
} from "./schema";

type BookingRow = Pick<
  typeof assetBookings.$inferInsert,
  "siteId" | "title" | "startAt" | "endAt" | "updatedAt"
> & { id: string; status: "confirmed" | "pending"; archived: boolean };
const oneHour = 3_600_000;
const signal = () => AbortSignal.timeout(15_000);

async function resetEpoch(db: Db) {
  const [row] = await db
    .update(epoch)
    .set({ activeAt: sql`clock_timestamp() - interval '2 hours'` })
    .where(eq(epoch.id, true))
    .returning({ activeAt: epoch.activeAt });
  assert(row !== undefined);
  return row.activeAt.getTime();
}

function booking(siteId: string, title: string, end: number): BookingRow {
  return {
    siteId,
    title,
    id: randomUUID(),
    endAt: new Date(end),
    startAt: new Date(end - oneHour),
    updatedAt: new Date(end - oneHour),
    status: "confirmed",
    archived: false,
  };
}

function activities(
  rows: BookingRow[],
  actorId: string,
  version: number,
  kind: BookingEvent["kind"],
  status: "draft" | "pending" | "confirmed",
  archived = false,
) {
  return rows.map((row) => ({
    bookingId: row.id,
    siteId: row.siteId,
    version,
    kind,
    actorId,
    at: row.updatedAt,
    snapshot: {
      title: row.title,
      status,
      archived,
      lines: [],
      window: { startAt: row.startAt.toISOString(), endAt: row.endAt.toISOString() },
    },
  }));
}

async function seedBookings(db: Db, requesterId: string, rows: BookingRow[]) {
  await db.transaction(async (tx) => {
    const ids = rows.map(({ id }) => id);
    await tx.insert(assetBookings).values(
      rows.map((row): typeof assetBookings.$inferInsert => ({
        ...row,
        status: "draft",
        archived: false,
        version: 1,
        requesterId,
        requesterName: "Sample requester",
        requesterRole: "base",
      })),
    );
    await tx
      .insert(assetBookingEvents)
      .values(activities(rows, requesterId, 1, "created", "draft"));
    await tx
      .update(assetBookings)
      .set({ status: "pending", version: 2 })
      .where(inArray(assetBookings.id, ids));
    await tx
      .insert(assetBookingEvents)
      .values(activities(rows, requesterId, 2, "submitted", "pending"));
    const confirmed = rows.filter(({ status }) => status === "confirmed");
    await tx
      .update(assetBookings)
      .set({ status: "confirmed", version: 3 })
      .where(
        inArray(
          assetBookings.id,
          confirmed.map(({ id }) => id),
        ),
      );
    await tx
      .insert(assetBookingEvents)
      .values(activities(confirmed, requesterId, 3, "approved", "confirmed"));
    const archived = confirmed.filter((row) => row.archived);
    if (archived.length > 0) {
      await tx
        .update(assetBookings)
        .set({ archived: true, version: 4 })
        .where(
          inArray(
            assetBookings.id,
            archived.map(({ id }) => id),
          ),
        );
      await tx
        .insert(assetBookingEvents)
        .values(activities(archived, requesterId, 4, "archived", "confirmed", true));
    }
  });
}

async function closePickup(db: Db, row: BookingRow) {
  await db.insert(handovers).values({
    bookingId: row.id,
    siteId: row.siteId,
    approvedVersion: 3,
    version: 1,
    pickupClosed: true,
  });
}

async function seedHeldEquipment(db: Db, { id: bookingId, siteId, startAt }: BookingRow) {
  const assetId = randomUUID();
  const custodianId = randomUUID();
  const eventId = randomUUID();
  const holdingId = randomUUID();
  const name = "Calibrated meter";
  const code = "METER-A";
  const custodianName = "Loan holder";
  const note = "Confirmed booking pickup";
  await db.transaction(async (tx) => {
    await tx.insert(assetCustodians).values({
      id: custodianId,
      siteId,
      name: custodianName,
      kind: "non_login",
      version: 1,
    });
    await tx.insert(assetRecords).values({
      id: assetId,
      siteId,
      name,
      code,
      codeKey: code.toLowerCase(),
      tracking: "individual",
      version: 1,
    });
    await tx
      .insert(assetEvents)
      .values({ assetId, siteId, kind: "created", version: 1, at: startAt });
    await tx.update(assetRecords).set({ version: 2 }).where(eq(assetRecords.id, assetId));
    await tx.insert(assetEvents).values({
      id: eventId,
      assetId,
      siteId,
      kind: "updated",
      version: 2,
      at: startAt,
      quantity: 1,
      reason: note,
    });
    await tx.insert(assetCustodyHoldings).values({
      id: holdingId,
      siteId,
      assetId,
      tracking: "individual",
      custodianId,
      custodianName,
      quantity: 1,
      condition: "good",
      assignedAt: startAt,
    });
    await tx.insert(assetCustodyHistory).values({
      id: eventId,
      assetId,
      siteId,
      version: 2,
      action: "assign",
      holdingId,
      quantity: 1,
      toCustodianId: custodianId,
      toCustodianName: custodianName,
      condition: "good",
      note,
    });
    await tx.insert(handovers).values({
      bookingId,
      siteId,
      approvedVersion: 3,
      version: 1,
      pickupClosed: true,
      custodianId,
      custodianName,
    });
    await tx.insert(allocations).values({
      id: randomUUID(),
      bookingId,
      siteId,
      kind: "asset",
      assetId,
      holdingId,
      custodyEventId: eventId,
      issued: 1,
      outstanding: 1,
      snapshot: {
        lineKey: `asset:${assetId}:`,
        name,
        code,
        serial: null,
        sourceBin: null,
        members: [],
      },
    });
  });
}

it("records exact current overdue and missed pickup notices with no pre-rollout backfill or duplicates", async () => {
  const h = await makeTestDb();
  try {
    const { db } = h;
    const activeAt = await resetEpoch(db);
    const { userId: requesterId } = await actor(h, "Sample requester");
    const siteId = randomUUID();
    const archivedSite = randomUUID();
    await db.insert(directorySites).values([
      { id: siteId, name: "Automation Works", code: "WORKS" },
      { id: archivedSite, name: "Closed site", code: "CLOSED", archived: true },
    ]);
    const missed = booking(siteId, "Uncollected after rollout", activeAt + oneHour);
    const overdue = booking(siteId, "Equipment still in custody", activeAt - oneHour);
    const closed = booking(siteId, "Pickup closed deliberately", activeAt + oneHour);
    const amended = booking(siteId, "Deadline amended before next tick", activeAt + oneHour);
    const oldDeadline = amended.endAt.toISOString();
    await seedBookings(db, requesterId, [
      missed,
      overdue,
      closed,
      amended,
      booking(siteId, "Uncollected before rollout", activeAt - oneHour),
      booking(siteId, "Upcoming", activeAt + 3 * oneHour),
      { ...booking(siteId, "Pending approval", activeAt + oneHour), status: "pending" },
      { ...booking(siteId, "Archived booking", activeAt + oneHour), archived: true },
      booking(archivedSite, "Archived site", activeAt + oneHour),
    ]);
    await seedHeldEquipment(db, overdue);
    await closePickup(db, closed);
    const { id: overdueId } = overdue;
    const { id: missedId } = missed;
    const { id: amendedId } = amended;
    const amendment = { ...amended, endAt: new Date(activeAt + 3 * oneHour) };
    await db
      .update(assetBookings)
      .set({ endAt: amendment.endAt, version: 4 })
      .where(eq(assetBookings.id, amendedId));
    await db
      .insert(assetBookingEvents)
      .values(activities([amendment], requesterId, 4, "edited", "confirmed"));

    const passes = await Promise.all([
      recordBookingHandoverNotices(db, signal()),
      recordBookingHandoverNotices(db, signal()),
    ]);
    expect(passes.sort()).toEqual([0, 2]);
    const due = overdue.endAt.toISOString();
    const [overdueNotice] = await readBookingHandoverNotices(db, overdueId, siteId, due);
    assert(overdueNotice !== undefined);
    expect(overdueNotice).toMatchObject({ kind: "overdue", dueAt: due });
    expect(Date.parse(overdueNotice.at)).toBeGreaterThanOrEqual(Date.parse(due));
    expect(
      await readBookingHandoverNotices(db, missedId, siteId, missed.endAt.toISOString()),
    ).toMatchObject([{ kind: "expired" }]);
    expect(
      await readBookingHandoverNotices(db, missedId, archivedSite, missed.endAt.toISOString()),
    ).toEqual([]);
    expect(await readBookingHandoverNotices(db, amendedId, siteId, oldDeadline)).toEqual([]);
    expect(await recordBookingHandoverNotices(db, signal())).toBe(0);
    expect(await db.select().from(notices)).toHaveLength(2);
  } finally {
    await h.close();
  }
});

it("leaves eligible records beyond the batch bound for the next scheduled tick", async () => {
  const h = await makeTestDb();
  try {
    const { db } = h;
    const activeAt = await resetEpoch(db);
    const { userId: requesterId } = await actor(h, "Batch requester");
    const siteId = randomUUID();
    await db.insert(directorySites).values({ id: siteId, name: "Batch site", code: "BATCH" });
    await seedBookings(
      db,
      requesterId,
      Array.from({ length: 103 }, (_, index) =>
        booking(siteId, `Order ${index}`, activeAt + oneHour),
      ),
    );
    expect(await recordBookingHandoverNotices(db, signal())).toBe(100);
    expect(await recordBookingHandoverNotices(db, signal())).toBe(3);
    expect(await recordBookingHandoverNotices(db, signal())).toBe(0);
  } finally {
    await h.close();
  }
});
