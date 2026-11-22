import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { assert, expect, it } from "vitest";
import { users } from "@/db/schema/identity";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { createSourcingActor } from "@/features/inventory/sourcing/sourcing.test-helpers";
import {
  actor,
  seedStructures,
  signal,
} from "@/features/inventory/warehouse/operations/structures.test-helpers";
import { makeTestDb, type TestDb } from "@/test/db";
import { runAssetCommand } from "../service";
import type { BookingIntent } from "./contracts";
import {
  type BookingFeedCommand,
  bookingCalendarDownloadPath,
  bookingFeedSubscriptionPath,
} from "./feedContracts";
import {
  bookingCalendarResponse,
  readBookingCalendarDownload,
  readBookingCalendarSubscription,
  runBookingFeedCommand,
} from "./feedService";
import { assetBookingFeeds, assetBookingMemberships } from "./schema";
import { readBookingWorkspace, runBookingCommand } from "./service";

const unavailable = { ok: false, error: "unavailable" } as const;
const sensitiveDescription = "Internal booking notes are private";
type Endpoint = { siteId: string; locationId: string };

function edit(h: TestDb, who: NativeSessionRef, intent: BookingIntent) {
  return runBookingCommand(h.db, who, { ...intent, requestId: randomUUID() }, signal());
}

function command(h: TestDb, who: NativeSessionRef, value: BookingFeedCommand) {
  return runBookingFeedCommand(h.db, who, value, signal());
}

async function meter(h: TestDb, who: NativeSessionRef, location: Endpoint) {
  const result = await runAssetCommand(
    h.db,
    who,
    {
      type: "create",
      requestId: randomUUID(),
      ...location,
      code: "FEED-TEST-METER",
      name: "Private instrument name",
      description: null,
      categoryId: null,
      tags: [],
      fieldValues: {},
      tracking: "individual",
      serial: "FEED-TEST-SERIAL",
      modelId: null,
      openingQuantity: 0,
    },
    signal(),
  );
  assert(result.ok && result.focusId !== null);
  return result.focusId;
}

async function booking(
  h: TestDb,
  who: NativeSessionRef,
  location: Endpoint,
  resourceId: string,
  title: string,
  slot: number,
) {
  const startAt = new Date(Date.now() + (72 + slot * 2) * 3_600_000);
  const endAt = new Date(startAt.getTime() + 3_600_000);
  const saved = await edit(h, who, {
    type: "saveBooking",
    siteId: location.siteId,
    bookingId: null,
    version: null,
    requesterId: who.userId,
    title,
    description: sensitiveDescription,
    window: { startAt: startAt.toISOString(), endAt: endAt.toISOString() },
    lines: [{ kind: "asset", resourceId, locationId: location.locationId, quantity: 1 }],
  });
  assert(saved.ok && saved.bookingId !== null);
  const id = saved.bookingId;
  const draft = saved.value.bookings.find((record) => record.id === id);
  assert(draft !== undefined);
  const submitted = await edit(h, who, {
    type: "submitBooking",
    siteId: location.siteId,
    bookingId: id,
    version: draft.version,
  });
  assert(submitted.ok);
  const ready = submitted.value.bookings.find((record) => record.id === id);
  assert(ready !== undefined);
  return ready;
}

async function setup(h: TestDb) {
  const { admin, source, remote } = await seedStructures(h);
  const { siteId } = source;
  const owner = await actor(h, "Feed owner");
  const another = await actor(h, "Another request member");
  const viewer = await createSourcingActor(h, admin, "Asset viewer", siteId, "asset_viewer");
  await h.db.insert(assetBookingMemberships).values([
    { siteId, userId: owner.userId, role: "base" },
    { siteId, userId: another.userId, role: "self_service" },
  ]);
  const assetId = await meter(h, admin, source);
  const own = await booking(h, owner, source, assetId, "Owner calibrated test booking", 0);
  const others = await booking(h, another, source, assetId, "Another person's booking", 1);
  assert(own.status === "confirmed" && others.status === "confirmed");

  const state = await readBookingWorkspace(h.db, admin, signal());
  assert(state.ok);
  const site = state.value.sites.find(({ id }) => id === siteId);
  assert(site !== undefined);
  const policy = await edit(h, admin, {
    type: "savePolicy",
    siteId,
    version: site.policyVersion,
    policy: { ...site.policy, baseApproval: true },
  });
  assert(policy.ok);
  const pending = await booking(h, owner, source, assetId, "Pending private request", 2);
  assert(pending.status === "pending");
  return { admin, siteId, remote, owner, another, viewer, own, others, pending };
}

async function create(h: TestDb, who: NativeSessionRef, siteId: string, scope: "self" | "site") {
  const intent = { type: "create", siteId, scope, requestId: randomUUID() } as const;
  const result = await command(h, who, intent);
  assert(result.ok && result.created !== null);
  return { intent, credential: result.created };
}

it("downloads one calendar record only with current native visibility and private response headers", async () => {
  const h = await makeTestDb();
  try {
    const f = await setup(h);
    const content = await readBookingCalendarDownload(h.db, f.owner, f.own.id, signal());
    assert(content !== null);
    expect(content).toContain(`UID:${f.own.id}@`);
    expect(content).toContain(`SUMMARY:${f.own.title}`);
    expect(content).toContain("STATUS:CONFIRMED");
    expect(content).not.toContain(sensitiveDescription);
    expect(content).not.toContain("FEED-TEST-SERIAL");
    expect(content).not.toContain(f.others.title);
    expect(await readBookingCalendarDownload(h.db, f.owner, f.others.id, signal())).toBeNull();
    expect(await readBookingCalendarDownload(h.db, f.viewer, f.own.id, signal())).toBeNull();
    expect(await readBookingCalendarDownload(h.db, f.admin, f.others.id, signal())).toContain(
      f.others.title,
    );
    expect(await readBookingCalendarDownload(h.db, f.owner, f.pending.id, signal())).toContain(
      "STATUS:TENTATIVE",
    );
    expect(await readBookingCalendarDownload(h.db, f.owner, "not-a-uuid", signal())).toBeNull();

    const response = bookingCalendarResponse(content, true);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="booking.ics"');
    expect(await response.text()).toBe(content);
    const denied = bookingCalendarResponse(null);
    expect(denied.status).toBe(404);
    expect(denied.headers.get("cache-control")).toBe("private, no-store");
    expect(await denied.text()).toBe("");
    expect(bookingCalendarDownloadPath(f.own.id)).toBe(
      `/api/assets/bookings/${f.own.id}/calendar.ics`,
    );
  } finally {
    await h.close();
  }
});

it("shows each feed credential once and rechecks revocation, active staff, and the current site role", async () => {
  const h = await makeTestDb();
  try {
    const f = await setup(h);
    const { owner, siteId, admin, another } = f;
    expect(
      await command(h, owner, {
        type: "create",
        siteId,
        scope: "site",
        requestId: randomUUID(),
      }),
    ).toEqual(unavailable);
    expect(await command(h, owner, { type: "list", siteId: f.remote.siteId })).toEqual(unavailable);
    expect(await command(h, f.viewer, { type: "list", siteId })).toEqual(unavailable);
    const self = await create(h, owner, siteId, "self");
    const shared = await create(h, admin, siteId, "site");
    await checkFeedCredentials(h, f, self, shared);

    const secret = self.credential.secret;
    const bearer = () =>
      readBookingCalendarSubscription(h.db, self.credential.id, secret, signal());
    await h.db.update(users).set({ isActive: false }).where(eq(users.id, owner.userId));
    expect(await bearer()).toBeNull();
    await h.db.update(users).set({ isActive: true }).where(eq(users.id, owner.userId));
    expect(await bearer()).toContain(f.own.title);
    await h.db
      .delete(assetBookingMemberships)
      .where(eq(assetBookingMemberships.userId, owner.userId));
    expect(await bearer()).toBeNull();
    await h.db
      .insert(assetBookingMemberships)
      .values({ siteId, userId: owner.userId, role: "base" });

    expect(
      await command(h, another, { type: "revoke", siteId, feedId: self.credential.id }),
    ).toEqual(unavailable);
    const revoked = await command(h, owner, { type: "revoke", siteId, feedId: self.credential.id });
    expect(revoked).toMatchObject({
      ok: true,
      feeds: [{ id: self.credential.id, revokedAt: expect.any(String) }],
      created: null,
    });
    expect(await bearer()).toBeNull();
    expect(await command(h, owner, self.intent)).toEqual(revoked);

    const sharedBearer = () =>
      readBookingCalendarSubscription(
        h.db,
        shared.credential.id,
        shared.credential.secret,
        signal(),
      );
    await h.db.update(users).set({ isAdmin: false }).where(eq(users.id, admin.userId));
    expect(await sharedBearer()).toBeNull();
  } finally {
    await h.close();
  }
});

async function checkFeedCredentials(
  h: TestDb,
  f: Awaited<ReturnType<typeof setup>>,
  self: Awaited<ReturnType<typeof create>>,
  shared: Awaited<ReturnType<typeof create>>,
) {
  const { owner, another, siteId } = f;
  expect(self.credential.secret).toMatch(/^wd_booking_[A-Za-z0-9_-]{43}$/u);
  const [stored] = await h.db
    .select()
    .from(assetBookingFeeds)
    .where(eq(assetBookingFeeds.id, self.credential.id));
  expect(stored?.secretDigest).toBe(
    createHash("sha256").update(self.credential.secret).digest("hex"),
  );
  const noSecret = await command(h, owner, { type: "list", siteId });
  expect(noSecret).toMatchObject({
    ok: true,
    feeds: [{ id: self.credential.id, scope: "self", revokedAt: null }],
    created: null,
  });
  expect(JSON.stringify(noSecret)).not.toContain("secret");
  expect(await command(h, owner, self.intent)).toEqual(noSecret);
  expect(await command(h, another, self.intent)).toEqual(unavailable);
  expect(await command(h, another, { type: "list", siteId })).toEqual({
    ok: true,
    feeds: [],
    created: null,
  });
  const url = new URL(
    bookingFeedSubscriptionPath(self.credential.id, self.credential.secret),
    "https://workspace.example.test",
  );
  expect(url.pathname).toBe(`/api/assets/bookings/feeds/${self.credential.id}/calendar.ics`);
  expect(url.searchParams.get("token")).toBe(self.credential.secret);

  const own = await readBookingCalendarSubscription(
    h.db,
    self.credential.id,
    self.credential.secret,
    signal(),
  );
  assert(own !== null);
  expect(own).toContain(f.own.title);
  expect(own).not.toContain(f.others.title);
  expect(own).not.toContain(f.pending.title);
  expect(own).not.toContain(sensitiveDescription);
  expect(
    await readBookingCalendarSubscription(
      h.db,
      self.credential.id,
      shared.credential.secret,
      signal(),
    ),
  ).toBeNull();

  const site = await readBookingCalendarSubscription(
    h.db,
    shared.credential.id,
    shared.credential.secret,
    signal(),
  );
  assert(site !== null);
  expect(site.match(/BEGIN:VEVENT/gu)).toHaveLength(2);
  expect(site).toContain("SUMMARY:Equipment booking");
  for (const booking of [f.own, f.others, f.pending]) {
    expect(site).not.toContain(booking.title);
    expect(site).not.toContain(booking.id);
  }
  expect(site).not.toContain(sensitiveDescription);
  expect(
    await readBookingCalendarSubscription(
      h.db,
      shared.credential.id,
      shared.credential.secret,
      signal(),
    ),
  ).toBe(site);
}
