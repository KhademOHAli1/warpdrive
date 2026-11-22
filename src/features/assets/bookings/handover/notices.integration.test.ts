import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { assert, expect, it } from "vitest";
import type { Db } from "@/db/client";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { actor } from "@/features/inventory/warehouse/operations/structures.test-helpers";
import { directorySites } from "@/features/locations/schema";
import { makeTestDb } from "@/test/db";
import { assetCustodians, assetCustodyHistory, assetCustodyHoldings } from "../../custody/schema";
import { assetEvents, assetRecords } from "../../schema";
import { dispatchBookingAutomations } from "../automations/dispatch";
import {
  assetBookingAutomationAttempts as automationAttempts,
  assetBookingAutomationProfiles as automationProfiles,
  assetBookingAutomationRuns as automationRuns,
} from "../automations/schema";
import type { BookingEvent } from "../contracts";
import { runBookingMembershipCommand } from "../membershipService";
import { assetBookingEvents, assetBookings } from "../schema";
import { runBookingCommand } from "../service";
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
    if (confirmed.length > 0) {
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
    }
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

async function requestChanges(db: Db, admin: NativeSessionRef, row: BookingRow) {
  const result = await runBookingCommand(
    db,
    admin,
    {
      type: "reviewBooking",
      decision: "request_changes",
      reason: "Check the pickup time",
      siteId: row.siteId,
      bookingId: row.id,
      version: 2,
      requestId: randomUUID(),
    },
    signal(),
  );
  assert(result.ok, JSON.stringify(result));
}

async function setRequester(
  db: Db,
  admin: NativeSessionRef,
  who: NativeSessionRef,
  siteId: string,
  role: "base" | null,
) {
  const result = await runBookingMembershipCommand(
    db,
    admin,
    {
      siteId,
      userId: who.userId,
      role,
      requestId: randomUUID(),
    },
    signal(),
  );
  assert(result.ok);
}

it("dispatches only exact configured occurrences, isolates a contended delivery and commits each run separately", async () => {
  const h = await makeTestDb();
  try {
    const { db } = h;
    const epochStart = await resetEpoch(db);
    const admin = await actor(h, "Automation administrator", true);
    const requester = await actor(h, "Equipment requester");
    const revoked = await actor(h, "Revoked equipment requester");
    const siteId = randomUUID();
    await db.insert(directorySites).values({ id: siteId, name: "Automation works", code: "WORKS" });
    await setRequester(db, admin, requester, siteId, "base");
    await setRequester(db, admin, revoked, siteId, "base");

    const pending = (title: string): BookingRow => ({
      ...booking(siteId, title, epochStart + 3 * oneHour),
      status: "pending",
    });
    const incumbent = pending("Sent back before configuration");
    await seedBookings(db, requester.userId, [incumbent]);
    await requestChanges(db, admin, incumbent);
    expect(await db.select().from(automationRuns)).toEqual([]);

    const enabledAt = new Date(epochStart + oneHour / 2);
    await db.insert(automationProfiles).values({
      siteId,
      version: 1,
      createdAt: enabledAt,
      updatedAt: enabledAt,
      sentBackEnabledAt: enabledAt,
      overdueEnabledAt: enabledAt,
      pickupExpiredEnabledAt: enabledAt,
    });
    const live = pending("Current request returned to the requester");
    const off = pending("Sent back between disable and reenable");
    const noLongerMember = pending("Request returned before membership removal");
    const oldDeadline = booking(
      siteId,
      "Missed before profile activation",
      epochStart + oneHour / 4,
    );
    const missed = booking(siteId, "Missed pickup", epochStart + oneHour);
    const overdue = booking(siteId, "Outstanding equipment overdue", epochStart + oneHour);
    await seedBookings(db, requester.userId, [live, off, oldDeadline, missed, overdue]);
    await seedBookings(db, revoked.userId, [noLongerMember]);
    await seedHeldEquipment(db, overdue);

    await db
      .update(automationProfiles)
      .set({ version: 2, sentBackEnabledAt: null, updatedAt: sql`statement_timestamp()` })
      .where(eq(automationProfiles.siteId, siteId));
    await requestChanges(db, admin, off);
    await db
      .update(automationProfiles)
      .set({
        version: 3,
        sentBackEnabledAt: sql`statement_timestamp()`,
        updatedAt: sql`statement_timestamp()`,
      })
      .where(eq(automationProfiles.siteId, siteId));
    await requestChanges(db, admin, noLongerMember);
    await requestChanges(db, admin, live);
    await setRequester(db, admin, revoked, siteId, null);
    expect(await recordBookingHandoverNotices(db, signal())).toBe(3);
    expect(await db.select().from(notices)).toHaveLength(3);

    const currentRuns = await db.select().from(automationRuns);
    expect(currentRuns.map(({ bookingId, trigger }) => [bookingId, trigger])).toEqual(
      expect.arrayContaining([
        [live.id, "request_sent_back"],
        [off.id, "request_sent_back"],
        [noLongerMember.id, "request_sent_back"],
        [missed.id, "pickup_expired"],
        [overdue.id, "return_overdue"],
      ]),
    );
    expect(currentRuns).toHaveLength(5);
    expect(
      currentRuns.every(
        ({ state, principalId }) =>
          state === "pending" && principalId === currentRuns[0]?.principalId,
      ),
    ).toBe(true);

    await db.execute(sql`
      CREATE FUNCTION temporary_booking_delivery_contention() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.outcome = 'delivered' AND EXISTS (
          SELECT 1 FROM asset_booking_automation_runs WHERE id = NEW.run_id AND trigger = 'return_overdue'
        ) THEN
          RAISE EXCEPTION 'isolated delivery contention' USING ERRCODE = '55P03';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await db.execute(sql`CREATE TRIGGER booking_delivery_contention BEFORE INSERT ON asset_booking_automation_attempts
      FOR EACH ROW EXECUTE FUNCTION temporary_booking_delivery_contention()`);
    const passes = await Promise.all([
      dispatchBookingAutomations(db, signal()),
      dispatchBookingAutomations(db, signal()),
    ]);
    expect(passes.reduce((sum, count) => sum + count, 0)).toBe(5);
    expect(await recordBookingHandoverNotices(db, signal())).toBe(0);
    expect(await dispatchBookingAutomations(db, signal())).toBe(0);

    const effects = await db
      .select({
        bookingId: automationRuns.bookingId,
        state: automationRuns.state,
        outcome: automationAttempts.outcome,
        reason: automationAttempts.reason,
      })
      .from(automationRuns)
      .innerJoin(automationAttempts, eq(automationAttempts.runId, automationRuns.id));
    expect(effects).toHaveLength(5);
    expect(effects).toEqual(
      expect.arrayContaining([
        { bookingId: live.id, state: "delivered", outcome: "delivered", reason: null },
        { bookingId: off.id, state: "skipped", outcome: "skipped", reason: "rule_disabled" },
        {
          bookingId: noLongerMember.id,
          state: "skipped",
          outcome: "skipped",
          reason: "recipient_unavailable",
        },
        { bookingId: missed.id, state: "delivered", outcome: "delivered", reason: null },
        { bookingId: overdue.id, state: "failed", outcome: "failed", reason: "temporary" },
      ]),
    );
    await db.execute(
      sql`DROP TRIGGER booking_delivery_contention ON public.asset_booking_automation_attempts`,
    );
    await db.execute(sql`DROP FUNCTION temporary_booking_delivery_contention()`);

    const first = pending("First booking committed in this tick");
    const second = pending("Second booking interrupted in this tick");
    await seedBookings(db, requester.userId, [first, second]);
    await requestChanges(db, admin, first);
    await requestChanges(db, admin, second);
    const aborted = new AbortController();
    await expect(
      dispatchBookingAutomations(db, aborted.signal, ({ bookingId }) => {
        if (bookingId === second.id) aborted.abort();
        return null;
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    const remaining = await db
      .select({ bookingId: automationRuns.bookingId, state: automationRuns.state })
      .from(automationRuns)
      .where(inArray(automationRuns.bookingId, [first.id, second.id]));
    expect(remaining).toEqual(
      expect.arrayContaining([
        { bookingId: first.id, state: "delivered" },
        { bookingId: second.id, state: "pending" },
      ]),
    );
    expect(await dispatchBookingAutomations(db, signal())).toBe(1);

    const held = pending("Locked automation run");
    const free = pending("Uncontended automation run");
    await seedBookings(db, requester.userId, [held, free]);
    await requestChanges(db, admin, held);
    await requestChanges(db, admin, free);
    const [lockedRun] = await db
      .select({ id: automationRuns.id })
      .from(automationRuns)
      .where(eq(automationRuns.bookingId, held.id));
    assert(lockedRun !== undefined);
    const locker = await h.pool.connect();
    try {
      await locker.query("BEGIN");
      const lock = await locker.query(
        "SELECT id FROM public.asset_booking_automation_runs WHERE id = $1 FOR UPDATE",
        [lockedRun.id],
      );
      expect(lock.rowCount).toBe(1);
      expect(await dispatchBookingAutomations(db, signal())).toBe(1);
      expect(
        await db
          .select()
          .from(automationAttempts)
          .where(eq(automationAttempts.runId, lockedRun.id)),
      ).toEqual([]);
      const states = await db
        .select({ bookingId: automationRuns.bookingId, state: automationRuns.state })
        .from(automationRuns)
        .where(inArray(automationRuns.bookingId, [held.id, free.id]));
      expect(states).toEqual(
        expect.arrayContaining([
          { bookingId: held.id, state: "pending" },
          { bookingId: free.id, state: "delivered" },
        ]),
      );
    } finally {
      try {
        await locker.query("ROLLBACK");
      } finally {
        locker.release();
      }
    }
    expect(await dispatchBookingAutomations(db, signal())).toBe(1);
    expect(
      await db.select().from(automationAttempts).where(eq(automationAttempts.runId, lockedRun.id)),
    ).toMatchObject([{ ordinal: 1, outcome: "delivered", reason: null }]);
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
