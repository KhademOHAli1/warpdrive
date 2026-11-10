import { eq } from "drizzle-orm";
import { afterEach, assert, beforeEach, expect, it, vi } from "vitest";
import { calendarProviderAccounts, sessions, users } from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import { createSession } from "@/features/auth/session";
import { makeTestDb } from "@/test/db";
import { connectTestCalendar, calendarTestSignal as signal } from "./accountTestHelpers";
import {
  catalogFixture,
  catalogTransport,
  discoverCatalog,
  forbidProviderNetwork,
  initialCatalogCalendar,
  readCatalog,
  readyCatalogFixture,
} from "./calendarCatalog.test-helpers";

let ctx: Awaited<ReturnType<typeof makeTestDb>>;
let network: ReturnType<typeof forbidProviderNetwork>;
beforeEach(async () => {
  ctx = await makeTestDb();
  network = forbidProviderNetwork();
});
afterEach(async () => {
  try {
    expect(network).not.toHaveBeenCalled();
  } finally {
    network.mockRestore();
    await ctx.close();
  }
});

it("publishes a complete two-page catalog with exact opaque IDs and owner-safe persisted metadata", async () => {
  const fixture = await catalogFixture(ctx.db);
  expect(await readCatalog(ctx.db, fixture)).toMatchObject({
    accountId: fixture.accountId,
    revision: 0,
    status: "empty",
    calendars: [],
    discoveredAt: null,
  });
  const urls: URL[] = [];
  const date = new Date("2030-04-03T09:00:00Z");
  const result = await discoverCatalog(ctx.db, fixture, [], {
    now: () => date,
    transport: catalogTransport(
      [
        { items: [initialCatalogCalendar], nextPageToken: "second+/=" },
        {
          items: [{ id: "TEAM/a?b@example.invalid", summary: "Read only", accessRole: "reader" }],
          nextSyncToken: "private-catalog-cursor",
        },
      ],
      (url) => urls.push(url),
    ),
  });
  expect(result.ok).toBe(true);
  const listed = await readCatalog(ctx.db, fixture);
  expect(listed).toMatchObject({
    accountId: fixture.accountId,
    revision: 1,
    status: "ready",
    discoveredAt: date.toISOString(),
  });
  expect(listed.calendars).toHaveLength(2);
  expect(listed.calendars).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        calendarId: initialCatalogCalendar.id,
        name: initialCatalogCalendar.summary,
        timeZone: "Asia/Tehran",
        accessRole: "writer",
        hidden: true,
        deleted: false,
        available: true,
        supportsMeet: true,
      }),
      expect.objectContaining({
        calendarId: "TEAM/a?b@example.invalid",
        name: "Read only",
        timeZone: null,
        accessRole: "reader",
        available: true,
        supportsMeet: false,
      }),
    ]),
  );
  expect(listed.calendars.every((row) => /^[0-9a-f-]{36}$/i.test(row.id))).toBe(true);
  expect(new Set(listed.calendars.map((row) => row.id)).size).toBe(2);
  expect(urls.map((url) => url.searchParams.get("pageToken"))).toEqual([null, "second+/="]);
  expect(
    urls.every(
      (url) =>
        url.searchParams.get("showDeleted") === "true" &&
        url.searchParams.get("showHidden") === "true" &&
        !url.searchParams.has("syncToken"),
    ),
  ).toBe(true);
  for (const secret of [
    "private-catalog-cursor",
    "access-token",
    "refresh-secret",
    "rawPayload",
    "syncToken",
  ])
    expect(JSON.stringify(listed)).not.toContain(secret);
});

it("a later-page failure retains the prior revision, rows and discovery timestamp", async () => {
  const fixture = await readyCatalogFixture(ctx.db);
  const result = await discoverCatalog(ctx.db, fixture, [
    { items: [{ id: "partial-must-not-publish", accessRole: "owner" }], nextPageToken: "fails" },
    new Response(JSON.stringify({ error: { message: "synthetic failure" } }), { status: 503 }),
  ]);
  expect(result.ok).toBe(false);
  const listed = await readCatalog(ctx.db, fixture);
  expect(listed.status).toBe("error");
  expect(listed.revision).toBe(fixture.catalog.revision);
  expect(listed.discoveredAt).toBe(fixture.catalog.discoveredAt);
  expect(listed.calendars).toEqual(fixture.catalog.calendars);
});

it("omitted, sparse deleted and missing-role entries become unavailable while reappearance keeps stable IDs", async () => {
  const fixture = await catalogFixture(ctx.db);
  const entries = [
    initialCatalogCalendar,
    { ...initialCatalogCalendar, id: "deleted" },
    { ...initialCatalogCalendar, id: "unknown-role" },
  ];
  expect(
    (await discoverCatalog(ctx.db, fixture, [{ items: entries, nextSyncToken: "baseline" }])).ok,
  ).toBe(true);
  const baseline = await readCatalog(ctx.db, fixture);
  const ids = new Map(baseline.calendars.map((row) => [row.calendarId, row.id]));
  expect(
    (
      await discoverCatalog(ctx.db, fixture, [
        {
          items: [
            { id: "deleted", deleted: true },
            { id: "unknown-role", summary: "Unknown permission" },
          ],
          nextSyncToken: "unavailable",
        },
      ])
    ).ok,
  ).toBe(true);
  const unavailable = await readCatalog(ctx.db, fixture);
  expect(unavailable.calendars).toHaveLength(3);
  expect(unavailable.calendars.every((row) => !row.available)).toBe(true);
  expect(unavailable.calendars.find((row) => row.calendarId === "deleted")).toMatchObject({
    id: ids.get("deleted"),
    deleted: true,
    accessRole: null,
    supportsMeet: false,
  });
  expect(unavailable.calendars.find((row) => row.calendarId === "unknown-role")).toMatchObject({
    id: ids.get("unknown-role"),
    accessRole: null,
    timeZone: null,
    supportsMeet: false,
  });
  expect((await discoverCatalog(ctx.db, fixture, [{ nextSyncToken: "empty" }])).ok).toBe(true);
  const empty = await readCatalog(ctx.db, fixture);
  expect(empty.calendars.every((row) => !row.available)).toBe(true);
  expect(empty.revision).toBe(baseline.revision + 2);
  expect(
    (
      await discoverCatalog(ctx.db, fixture, [
        { items: [initialCatalogCalendar], nextSyncToken: "returned" },
      ])
    ).ok,
  ).toBe(true);
  expect(
    (await readCatalog(ctx.db, fixture)).calendars.find(
      (row) => row.calendarId === initialCatalogCalendar.id,
    ),
  ).toMatchObject({ id: ids.get(initialCatalogCalendar.id), available: true });
});

it.each(["wrong owner", "inactive owner"] as const)(
  "%s cannot discover or read an existing catalog",
  async (kind) => {
    const fixture = await readyCatalogFixture(ctx.db);
    const requester = kind === "wrong owner" ? (await seedUser(ctx.db)).id : fixture.userId;
    if (kind === "inactive owner")
      await ctx.db.update(users).set({ isActive: false }).where(eq(users.id, fixture.userId));
    const api = await import("./calendarCatalog");
    const transport = vi.fn(catalogTransport([{ nextSyncToken: "must-not-request" }]));
    const result = await discoverCatalog(ctx.db, { ...fixture, userId: requester }, [], {
      transport,
    });
    expect(result).toEqual({ ok: false, error: { kind: "not_found" } });
    expect(
      await api.listGoogleCalendarCatalog(ctx.db, requester, fixture.accountId, signal()),
    ).toEqual({ ok: false, error: { kind: "not_found" } });
    expect(transport).not.toHaveBeenCalled();
  },
);

it("the same opaque calendar ID has separate stable identities and permissions in separate owned accounts", async () => {
  const first = await readyCatalogFixture(ctx.db);
  const secondAccount = await connectTestCalendar(ctx.db, first.userId, {
    subject: "second-subject",
  });
  const second = { userId: first.userId, accountId: secondAccount.accountId };
  expect(
    (
      await discoverCatalog(ctx.db, second, [
        { items: [{ ...initialCatalogCalendar, accessRole: "reader" }], nextSyncToken: "second" },
      ])
    ).ok,
  ).toBe(true);
  const independent = await readCatalog(ctx.db, second);
  expect(independent.calendars[0]?.id).not.toBe(first.catalog.calendars[0]?.id);
  expect(independent.calendars[0]?.accessRole).toBe("reader");
  expect((await discoverCatalog(ctx.db, first, [{ nextSyncToken: "first-removed" }])).ok).toBe(
    true,
  );
  expect(await readCatalog(ctx.db, second)).toEqual(independent);
});

it("does not publish or return a private provider catalog after the initiating session logs out during HTTP", async () => {
  const fixture = await readyCatalogFixture(ctx.db);
  const current = await createSession(ctx.db, fixture.userId, signal());
  assert(current.ok);
  let entered: () => void = () => undefined;
  const enteredPromise = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const transport = catalogTransport([
    {
      items: [{ id: "private-after-logout", summary: "Private", accessRole: "owner" }],
      nextSyncToken: "private-cursor",
    },
  ]);
  const api = await import("./calendarCatalog");
  const { calendarTestConfig } = await import("./accountTestHelpers");
  const pending = api.discoverGoogleCalendarCatalog(
    ctx.db,
    fixture.userId,
    fixture.accountId,
    calendarTestConfig,
    signal(),
    {
      nativeSession: { userId: fixture.userId, sessionId: current.value.sessionId },
      transport: async (url, init) => {
        if (url.includes("/calendar/v3/users/me/calendarList")) {
          entered();
          await released;
        }
        return transport(url, init);
      },
    },
  );
  try {
    await enteredPromise;
    const before = await ctx.db.select().from(calendarProviderAccounts);
    await ctx.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.id, current.value.sessionId));
    release();
    expect(await pending).toEqual({ ok: false, error: { kind: "unauthorized" } });
    const after = await readCatalog(ctx.db, fixture);
    expect(after.revision).toBe(fixture.catalog.revision);
    expect(after.calendars).toEqual(fixture.catalog.calendars);
    expect(JSON.stringify(after)).not.toContain("private-after-logout");
    expect(await ctx.db.select().from(calendarProviderAccounts)).toEqual(before);
  } finally {
    release();
    await pending;
  }
});
