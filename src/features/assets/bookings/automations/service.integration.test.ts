import { randomUUID } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import { assert, expect, it } from "vitest";
import { sessions, users } from "@/db/schema/identity";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { createSourcingActor, setRole } from "@/features/inventory/sourcing/sourcing.test-helpers";
import { actor, signal } from "@/features/inventory/warehouse/operations/structures.test-helpers";
import { directoryLocations, directorySites } from "@/features/locations/schema";
import { executeLocationsCommand } from "@/features/locations/service";
import { makeTestDb, type TestDb } from "@/test/db";
import { runAssetCommand } from "../../service";
import type { Booking, BookingIntent, BookingResult } from "../contracts";
import { runBookingMembershipCommand } from "../membershipService";
import { assetBookingEvents, assetBookings } from "../schema";
import { readBookingWorkspace, runBookingCommand } from "../service";
import type { BookingAutomationProfileInput, BookingAutomationRunInput } from "./contracts";
import { dispatchBookingAutomations } from "./dispatch";
import {
  assetBookingAutomationAttempts,
  assetBookingAutomationProfiles,
  assetBookingAutomationReceipts,
  assetBookingAutomationRuns,
} from "./schema";
import {
  readBookingAutomationNotices,
  readBookingAutomationRuns,
  retryBookingAutomationRun,
  saveBookingAutomationProfile,
} from "./service";

const unavailable = { ok: false, error: "unavailable" } as const;
const conflict = { ok: false, error: "conflict" } as const;
const invalid = { ok: false, error: "invalid" } as const;
const emptyNotices = { ok: true, value: [] } as const;

function success<T extends { ok: boolean }>(value: T): Extract<T, { ok: true }> {
  assert(value.ok, JSON.stringify(value));
  return value as Extract<T, { ok: true }>;
}

function bookingAt(result: BookingResult) {
  const { value, bookingId } = success(result);
  const booking = value.bookings.find(({ id }) => id === bookingId);
  assert(booking !== undefined);
  return booking;
}

function run(h: TestDb, who: NativeSessionRef, input: BookingIntent) {
  return runBookingCommand(h.db, who, { ...input, requestId: randomUUID() }, signal());
}

function list(h: TestDb, who: NativeSessionRef, input: BookingAutomationRunInput) {
  return readBookingAutomationRuns(h.db, who, input, signal());
}

function save(h: TestDb, who: NativeSessionRef, input: BookingAutomationProfileInput) {
  return saveBookingAutomationProfile(h.db, who, input, signal());
}

function notices(h: TestDb, who: NativeSessionRef, bookingId: string) {
  return readBookingAutomationNotices(h.db, who, bookingId, signal());
}

async function setMembership(
  h: TestDb,
  { admin, siteId }: Pick<Fixture, "admin" | "siteId">,
  who: NativeSessionRef,
  role: "base" | "self_service" | null,
) {
  success(
    await runBookingMembershipCommand(
      h.db,
      admin,
      { siteId, userId: who.userId, role, requestId: randomUUID() },
      signal(),
    ),
  );
}

async function seedScopes(h: TestDb) {
  const admin = await actor(h, "Site administrator", true);
  const siteId = randomUUID();
  const remoteId = randomUUID();
  const binId = randomUUID();
  await h.db.insert(directorySites).values([
    { id: siteId, code: "AUTO-HOME", name: "Automation equipment floor" },
    { id: remoteId, code: "AUTO-REMOTE", name: "Other operations site" },
  ]);
  await h.db
    .insert(directoryLocations)
    .values({ id: binId, siteId, code: "AUTO-BENCH", name: "Test desk" });
  const manager = await createSourcingActor(
    h,
    admin,
    "Home equipment manager",
    siteId,
    "asset_manager",
  );
  const viewer = await createSourcingActor(h, admin, "Calendar viewer", siteId, "asset_viewer");
  const foreignManager = await createSourcingActor(
    h,
    admin,
    "Foreign equipment manager",
    remoteId,
    "asset_manager",
  );
  const requester = await actor(h, "Test equipment requester");
  const other = await actor(h, "Other equipment requester");
  const guest = await actor(h, "Project guest");
  await h.db.update(users).set({ projectsGuestOnly: true }).where(eq(users.id, guest.userId));
  await setMembership(h, { admin, siteId }, requester, "base");
  await setMembership(h, { admin, siteId }, other, "self_service");
  return {
    admin,
    siteId,
    remoteId,
    binId,
    manager,
    viewer,
    foreignManager,
    requester,
    other,
    guest,
  };
}

type Fixture = Awaited<ReturnType<typeof seedScopes>>;

async function configureBookings(h: TestDb, f: Fixture) {
  const workspace = success(await readBookingWorkspace(h.db, f.admin, signal())).value;
  const site = workspace.sites.find(({ id }) => id === f.siteId);
  assert(site !== undefined);
  success(
    await run(h, f.admin, {
      type: "savePolicy",
      siteId: f.siteId,
      version: site.policyVersion,
      policy: { ...site.policy, baseApproval: true },
    }),
  );
  const { focusId } = success(
    await runAssetCommand(
      h.db,
      f.manager,
      {
        type: "create",
        siteId: f.siteId,
        requestId: randomUUID(),
        code: "AUTO-METER",
        name: "Audit meter",
        tracking: "individual",
        serial: "AUTO-MTR-01",
        categoryId: null,
        description: null,
        tags: [],
        fieldValues: {},
        modelId: null,
        locationId: f.binId,
        openingQuantity: 0,
      },
      signal(),
    ),
  );
  assert(focusId !== null);
  return focusId;
}

function pin({ id, siteId, version }: Booking) {
  return { siteId, bookingId: id, version };
}

async function pendingBooking(h: TestDb, f: Fixture, assetId: string, title: string, offset = 0) {
  const start = Date.now() + (48 + 2 * offset) * 3_600_000;
  const draft = bookingAt(
    await run(h, f.requester, {
      type: "saveBooking",
      siteId: f.siteId,
      bookingId: null,
      version: null,
      title,
      description: "Do not expose a wider record in automation history",
      requesterId: f.requester.userId,
      window: {
        startAt: new Date(start).toISOString(),
        endAt: new Date(start + 3_600_000).toISOString(),
      },
      lines: [{ kind: "asset", resourceId: assetId, locationId: null, quantity: 1 }],
    }),
  );
  const booking = bookingAt(await run(h, f.requester, { type: "submitBooking", ...pin(draft) }));
  expect(booking.status).toBe("pending");
  return booking;
}

async function queueExactSentBackRun(
  h: TestDb,
  record: Pick<Booking, "id" | "siteId" | "version">,
) {
  // Mirror the worker's provenance join, including the full precision of the persisted event.
  await h.db.execute(sql`INSERT INTO ${assetBookingAutomationRuns}
    (site_id, principal_id, booking_id, recipient_id, trigger, source_version, scheduled_at)
    SELECT b.site_id, p.principal_id, b.id, b.requester_id, 'request_sent_back', e.version, e.at
    FROM ${assetBookings} b
    JOIN ${assetBookingEvents} e ON (e.site_id, e.booking_id, e.version) = (b.site_id, b.id, b.version)
    JOIN ${assetBookingAutomationProfiles} p ON p.site_id = b.site_id
    WHERE b.site_id = ${record.siteId} AND b.id = ${record.id} AND e.version = ${record.version} AND e.kind = 'sent_back'
    ON CONFLICT DO NOTHING`);
}

async function archiveSite(h: TestDb, f: Fixture) {
  success(
    await executeLocationsCommand(
      h.db,
      f.admin,
      { type: "setSiteArchived", requestId: randomUUID(), id: f.siteId, archived: true },
      signal(),
    ),
  );
}

it("uses exact manager scope before a profile change or replay and preserves original rule opt-in epochs", async () => {
  const h = await makeTestDb();
  try {
    const f = await seedScopes(h);
    const first: BookingAutomationProfileInput = {
      siteId: f.siteId,
      version: 0,
      triggers: ["request_sent_back"],
      requestId: randomUUID(),
    };
    const initial = success(await list(h, f.manager, { siteId: f.siteId })).value;
    expect(initial).toEqual({ profile: { version: 0, triggers: [] }, runs: [], nextCursor: null });
    for (const who of [f.foreignManager, f.viewer, f.guest, f.requester]) {
      expect(await list(h, who, { siteId: f.siteId })).toEqual(unavailable);
      expect(await save(h, who, first)).toEqual(unavailable);
    }
    expect(
      await save(h, f.manager, { ...first, triggers: ["request_sent_back", "request_sent_back"] }),
    ).toEqual(invalid);
    const opened = success(await save(h, f.manager, first));
    expect(opened.value).toEqual({ version: 1, triggers: ["request_sent_back"] });
    expect(await save(h, f.manager, first)).toEqual(opened);
    expect(await save(h, f.manager, { ...first, triggers: [] })).toEqual(conflict);
    expect(await save(h, f.manager, { ...first, requestId: randomUUID() })).toEqual(conflict);

    const profileDates = () =>
      h.db.execute<{
        id: string;
        sent: string | null;
        overdue: string | null;
        created: string;
      }>(sql`
      SELECT principal_id AS id, sent_back_enabled_at::text AS sent, overdue_enabled_at::text AS overdue, created_at::text AS created
      FROM ${assetBookingAutomationProfiles} WHERE site_id = ${f.siteId}`);
    const [original] = (await profileDates()).rows;
    assert(original?.sent !== null && original?.sent !== undefined);
    expect(original.sent).toBe(original.created);
    const next: BookingAutomationProfileInput = {
      ...first,
      version: 1,
      triggers: ["return_overdue", "request_sent_back"],
      requestId: randomUUID(),
    };
    const extended = success(await save(h, f.manager, next));
    expect(extended.value).toEqual({
      version: 2,
      triggers: ["request_sent_back", "return_overdue"],
    });
    expect(await save(h, f.manager, { ...next, triggers: [...next.triggers].reverse() })).toEqual(
      extended,
    );
    const [extendedDates] = (await profileDates()).rows;
    expect(extendedDates).toMatchObject({
      id: original.id,
      created: original.created,
      sent: original.sent,
      overdue: expect.any(String),
    });
    expect(await save(h, f.manager, first)).toEqual(extended);

    const outside = { ...first, siteId: f.remoteId };
    expect(await save(h, f.manager, outside)).toEqual(unavailable);
    await setRole(h, f.admin, f.manager, f.remoteId, "asset_manager");
    expect(await save(h, f.manager, outside)).toEqual(conflict);
    await archiveSite(h, f);
    expect(await list(h, f.manager, { siteId: f.siteId })).toMatchObject({
      ok: true,
      value: { profile: extended.value, runs: [] },
    });
    expect(await save(h, f.manager, next)).toEqual(unavailable);
    await setRole(h, f.admin, f.manager, f.siteId, "asset_manager", false);
    expect(await list(h, f.manager, { siteId: f.siteId })).toEqual(unavailable);
    expect(await h.db.select().from(assetBookingAutomationReceipts)).toHaveLength(2);
  } finally {
    await h.close();
  }
});

it("retries only the current failure, retains immutable attempts, and delivers only to the current requester with scope", async () => {
  const h = await makeTestDb();
  try {
    const f = await seedScopes(h);
    const assetId = await configureBookings(h, f);
    success(
      await save(h, f.manager, {
        siteId: f.siteId,
        version: 0,
        triggers: ["request_sent_back"],
        requestId: randomUUID(),
      }),
    );
    const pending = await pendingBooking(h, f, assetId, "Bench request for review");
    const sentBack = bookingAt(
      await run(h, f.manager, {
        type: "reviewBooking",
        ...pin(pending),
        decision: "request_changes",
        reason: "Private changes requested text",
      }),
    );
    await queueExactSentBackRun(h, sentBack);
    expect(await dispatchBookingAutomations(h.db, signal(), () => "temporary")).toBe(1);
    const [failed] = success(await list(h, f.manager, { siteId: f.siteId, status: "failed" })).value
      .runs;
    assert(failed?.failureId !== null && failed?.failureId !== undefined);
    expect(failed).toMatchObject({
      bookingId: sentBack.id,
      title: sentBack.title,
      state: "failed",
      recipientName: sentBack.requesterName,
      attempts: [{ id: failed.failureId, outcome: "failed", reason: "temporary" }],
    });
    expect(JSON.stringify(failed)).not.toContain("Private changes requested text");
    expect(await notices(h, f.requester, sentBack.id)).toEqual(emptyNotices);
    expect(await notices(h, f.manager, sentBack.id)).toEqual(emptyNotices);
    for (const who of [f.other, f.viewer, f.foreignManager, f.guest])
      expect(await notices(h, who, sentBack.id)).toEqual(unavailable);
    const retry = (
      who: NativeSessionRef,
      input: { siteId: string; runId: string; failureId: string; requestId: string },
    ) => retryBookingAutomationRun(h.db, who, input, signal());
    const input = {
      siteId: f.siteId,
      runId: failed.id,
      failureId: failed.failureId,
      requestId: randomUUID(),
    };
    expect(await retry(f.requester, input)).toEqual(unavailable);
    expect(await retry(f.manager, { ...input, failureId: randomUUID() })).toEqual(conflict);
    const competing = { ...input, requestId: randomUUID() };
    const race = await Promise.all([retry(f.manager, input), retry(f.manager, competing)]);
    expect(race.filter(({ ok }) => ok)).toHaveLength(1);
    expect(race.find(({ ok }) => !ok)).toEqual(conflict);
    const joined = race.find(({ ok }) => ok);
    assert(joined?.ok === true);
    const won = race[0]?.ok === true ? input : competing;
    expect(joined.value).toMatchObject({
      state: "delivered",
      failureId: null,
      attempts: [
        { id: failed.failureId, outcome: "failed" },
        { outcome: "delivered", reason: null },
      ],
    });
    expect(await retry(f.manager, won)).toEqual(joined);
    expect(await retry(f.manager, { ...won, failureId: randomUUID() })).toEqual(conflict);
    const attempts = await h.db
      .select()
      .from(assetBookingAutomationAttempts)
      .where(eq(assetBookingAutomationAttempts.runId, failed.id))
      .orderBy(asc(assetBookingAutomationAttempts.ordinal));
    expect(attempts).toMatchObject([
      { ordinal: 1, actorId: null, id: failed.failureId },
      { ordinal: 2, actorId: f.manager.userId, outcome: "delivered" },
    ]);
    const delivered = success(await notices(h, f.requester, sentBack.id)).value;
    expect(delivered).toMatchObject([
      {
        id: failed.id,
        bookingId: sentBack.id,
        trigger: "request_sent_back",
        dueAt: null,
        deliveredAt: attempts[1]?.at.toISOString(),
      },
    ]);

    await setMembership(h, f, f.requester, null);
    expect(await notices(h, f.requester, sentBack.id)).toEqual(unavailable);
    await setMembership(h, f, f.requester, "base");
    expect(success(await notices(h, f.requester, sentBack.id)).value).toEqual(delivered);
    const reassigned = bookingAt(
      await run(h, f.manager, {
        type: "saveBooking",
        ...pin(sentBack),
        title: "New requester on the same draft",
        requesterId: f.other.userId,
        description: null,
        window: sentBack.window,
        lines: sentBack.lines.map(({ kind, resourceId, locationId, quantity }) => ({
          kind,
          resourceId,
          locationId,
          quantity,
        })),
      }),
    );
    expect(await notices(h, f.requester, reassigned.id)).toEqual(unavailable);
    expect(await notices(h, f.other, reassigned.id)).toEqual(emptyNotices);
    expect(success(await list(h, f.manager, { siteId: f.siteId })).value.runs[0]).toMatchObject({
      title: reassigned.title,
      recipientName: null,
    });

    const next = await pendingBooking(h, f, assetId, "Second request after reassignment", 1);
    const nextReview = bookingAt(
      await run(h, f.manager, {
        type: "reviewBooking",
        ...pin(next),
        decision: "request_changes",
        reason: null,
      }),
    );
    await queueExactSentBackRun(h, nextReview);
    expect(await dispatchBookingAutomations(h.db, signal(), () => "temporary")).toBe(1);
    const [nextFailure] = success(await list(h, f.manager, { siteId: f.siteId, status: "failed" }))
      .value.runs;
    assert(nextFailure?.failureId !== null && nextFailure?.failureId !== undefined);
    success(
      await save(h, f.manager, {
        siteId: f.siteId,
        version: 1,
        triggers: [],
        requestId: randomUUID(),
      }),
    );
    const skipped = success(
      await retry(f.manager, {
        siteId: f.siteId,
        runId: nextFailure.id,
        failureId: nextFailure.failureId,
        requestId: randomUUID(),
      }),
    );
    expect(skipped.value).toMatchObject({
      state: "skipped",
      failureId: null,
      attempts: [
        { id: nextFailure.failureId, outcome: "failed" },
        { outcome: "skipped", reason: "rule_disabled" },
      ],
    });
    expect(await notices(h, f.requester, nextReview.id)).toEqual(emptyNotices);

    await h.db
      .update(sessions)
      .set({ expiresAt: new Date(0) })
      .where(eq(sessions.id, f.manager.sessionId));
    expect(await retry(f.manager, won)).toEqual(unavailable);
    expect(await list(h, f.manager, { siteId: f.siteId })).toEqual(unavailable);
    expect(await h.db.select().from(assetBookingAutomationReceipts)).toHaveLength(4);
  } finally {
    await h.close();
  }
});

it("paginates actual scoped runs at microsecond precision and rejects the cursor in another filter or site", async () => {
  const h = await makeTestDb();
  try {
    const f = await seedScopes(h);
    const assetId = await configureBookings(h, f);
    success(
      await save(h, f.manager, {
        siteId: f.siteId,
        version: 0,
        triggers: ["request_sent_back"],
        requestId: randomUUID(),
      }),
    );
    // The test creates each valid pending booking through its ordinary native service. The source
    // activities then land inside one display millisecond so JS Date alone cannot paginate them.
    const pending: Booking[] = [];
    for (let index = 0; index < 7; index += 1)
      pending.push(await pendingBooking(h, f, assetId, `Instrument ${index}`, index));
    const clock = await h.db.execute<{ at: string }>(
      sql`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS at`,
    );
    const [tick] = clock.rows;
    assert(tick !== undefined);
    for (const [index, booking] of pending.entries()) {
      const at = `${tick.at}${String(index + 1).padStart(3, "0")}Z`;
      const version = booking.version + 1;
      await h.db.transaction(async (tx) => {
        await tx
          .update(assetBookings)
          .set({ version, status: "draft", updatedAt: sql`${at}::timestamptz` })
          .where(eq(assetBookings.id, booking.id));
        await tx.insert(assetBookingEvents).values({
          siteId: f.siteId,
          bookingId: booking.id,
          version,
          actorId: f.manager.userId,
          at: sql`${at}::timestamptz`,
          kind: "sent_back",
          reason: null,
          snapshot: {
            title: booking.title,
            window: booking.window,
            status: "draft",
            archived: false,
            lines: booking.lines,
          },
        });
      });
      await queueExactSentBackRun(h, { ...booking, version });
    }
    const input = { siteId: f.siteId, status: "pending" } as const;
    const first = success(await list(h, f.manager, input)).value;
    const cursor = first.nextCursor;
    assert(cursor !== null);
    expect(first.runs.map(({ bookingId }) => bookingId)).toEqual(
      pending
        .slice(2)
        .reverse()
        .map(({ id }) => id),
    );
    expect(first.runs[0]?.scheduledAt).toBe(first.runs[4]?.scheduledAt);
    expect(cursor).toContain(`${tick.at}003Z`);
    const second = success(await list(h, f.manager, { ...input, cursor })).value;
    expect(second.runs.map(({ bookingId }) => bookingId)).toEqual(
      pending
        .slice(0, 2)
        .reverse()
        .map(({ id }) => id),
    );
    expect(second.nextCursor).toBeNull();
    expect(await list(h, f.manager, { ...input, cursor, status: "delivered" })).toEqual(invalid);
    expect(await list(h, f.foreignManager, { ...input, cursor })).toEqual(unavailable);
    expect(await list(h, f.admin, { ...input, cursor, siteId: f.remoteId })).toEqual(invalid);
  } finally {
    await h.close();
  }
});
