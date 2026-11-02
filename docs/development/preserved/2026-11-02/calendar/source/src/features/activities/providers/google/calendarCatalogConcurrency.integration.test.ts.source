import { afterEach, beforeEach, expect, it } from "vitest";
import { seedUser } from "@/db/testing/factories";
import { setUserActive } from "@/features/identity/users.service";
import type { PermSetUser } from "@/features/permissions/effective";
import { makeTestDb } from "@/test/db";
import { finishCalendarAuthorization } from "./accountAuthorization";
import { disconnectCalendarProviderAccount } from "./accounts";
import {
  beginTestCalendar,
  calendarTestConfig,
  calendarTestTransport,
  calendarTestSignal as signal,
} from "./accountTestHelpers";
import { getCalendarAccessGrant } from "./accountTokens";
import { whileProviderBlocked } from "./calendarCatalog.gate-helpers";
import {
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

it("a newer successful run prevents an older same-generation run from restoring writer permissions", async () => {
  const fixture = await readyCatalogFixture(ctx.db);
  const older = await whileProviderBlocked(
    (transport, abort) => discoverCatalog(ctx.db, fixture, [], { transport, signal: abort }),
    catalogTransport([{ items: [initialCatalogCalendar], nextSyncToken: "older-writer" }]),
    async () => {
      expect(
        (
          await discoverCatalog(ctx.db, fixture, [
            {
              items: [
                { ...initialCatalogCalendar, accessRole: "reader", summary: "New reader state" },
              ],
              nextSyncToken: "newer-reader",
            },
          ])
        ).ok,
      ).toBe(true);
    },
  );
  expect(older.ok).toBe(false);
  const current = await readCatalog(ctx.db, fixture);
  expect(current).toMatchObject({ status: "ready", revision: fixture.catalog.revision + 1 });
  expect(current.calendars[0]).toMatchObject({
    id: fixture.catalog.calendars[0]?.id,
    name: "New reader state",
    accessRole: "reader",
  });
});

it("a newer failed run keeps the prior publication but permanently supersedes older in-flight success", async () => {
  const fixture = await readyCatalogFixture(ctx.db);
  const older = await whileProviderBlocked(
    (transport, abort) => discoverCatalog(ctx.db, fixture, [], { transport, signal: abort }),
    catalogTransport([
      {
        items: [{ ...initialCatalogCalendar, summary: "Stale replacement" }],
        nextSyncToken: "stale",
      },
    ]),
    async () => {
      const failed = await discoverCatalog(ctx.db, fixture, [
        new Response(JSON.stringify({ error: {} }), { status: 503 }),
      ]);
      expect(failed.ok).toBe(false);
      expect((await readCatalog(ctx.db, fixture)).status).toBe("error");
    },
  );
  expect(older.ok).toBe(false);
  const current = await readCatalog(ctx.db, fixture);
  expect(current.status).toBe("error");
  expect(current.revision).toBe(fixture.catalog.revision);
  expect(current.discoveredAt).toBe(fixture.catalog.discoveredAt);
  expect(current.calendars).toEqual(fixture.catalog.calendars);
});

it("ordinary token refresh during Calendar HTTP retains the discovery lifetime and its publication", async () => {
  const fixture = await readyCatalogFixture(ctx.db);
  const result = await whileProviderBlocked(
    (transport, abort) => discoverCatalog(ctx.db, fixture, [], { transport, signal: abort }),
    catalogTransport([
      {
        items: [{ ...initialCatalogCalendar, summary: "After refresh" }],
        nextSyncToken: "refreshed",
      },
    ]),
    async () => {
      const pending = await readCatalog(ctx.db, fixture);
      expect(pending.status).toBe("refreshing");
      expect(pending.calendars).toEqual(fixture.catalog.calendars);
      expect(
        (
          await getCalendarAccessGrant(
            ctx.db,
            fixture.userId,
            fixture.accountId,
            calendarTestConfig,
            signal(),
            { transport: calendarTestTransport({ refreshToken: "rotated-during-discovery" }) },
          )
        ).ok,
      ).toBe(true);
    },
  );
  expect(result.ok).toBe(true);
  const current = await readCatalog(ctx.db, fixture);
  expect(current).toMatchObject({ status: "ready", revision: fixture.catalog.revision + 1 });
  expect(current.calendars[0]?.name).toBe("After refresh");
});

it.each(["reconnect", "disconnect", "offboard"] as const)(
  "%s during Calendar HTTP hides the prior generation and rejects its late publication",
  async (change) => {
    const fixture = await readyCatalogFixture(ctx.db);
    const result = await whileProviderBlocked(
      (transport, abort) => discoverCatalog(ctx.db, fixture, [], { transport, signal: abort }),
      catalogTransport([
        {
          items: [{ ...initialCatalogCalendar, summary: "Must not publish" }],
          nextSyncToken: "obsolete",
        },
      ]),
      async () => {
        if (change === "reconnect") {
          const start = await beginTestCalendar(ctx.db, fixture.userId, fixture.accountId);
          expect(
            (
              await finishCalendarAuthorization(
                ctx.db,
                fixture.userId,
                calendarTestConfig,
                { ...start, code: "catalog-new-lifetime" },
                signal(),
                {
                  transport: calendarTestTransport({
                    refreshToken: "new-catalog-lifetime-refresh",
                  }),
                },
              )
            ).ok,
          ).toBe(true);
        } else if (change === "disconnect") {
          expect(
            (
              await disconnectCalendarProviderAccount(
                ctx.db,
                fixture.userId,
                fixture.accountId,
                signal(),
              )
            ).ok,
          ).toBe(true);
        } else {
          const user = await seedUser(ctx.db, { isAdmin: true });
          const admin: PermSetUser = {
            id: user.id,
            type: "admin",
            isActive: true,
            flags: new Set(),
            groupIds: new Set(),
          };
          expect(
            (
              await setUserActive(
                ctx.db,
                admin,
                { userId: fixture.userId, isActive: false },
                signal(),
              )
            ).ok,
          ).toBe(true);
          const api = await import("./calendarCatalog");
          expect(
            (
              await api.listGoogleCalendarCatalog(
                ctx.db,
                fixture.userId,
                fixture.accountId,
                signal(),
              )
            ).ok,
          ).toBe(false);
          expect(
            (
              await setUserActive(
                ctx.db,
                admin,
                { userId: fixture.userId, isActive: true },
                signal(),
              )
            ).ok,
          ).toBe(true);
        }
        const hidden = await readCatalog(ctx.db, fixture);
        expect(hidden.calendars).toEqual([]);
        expect(hidden.discoveredAt).toBeNull();
        expect(hidden.status).not.toBe("ready");
      },
    );
    expect(result.ok).toBe(false);
    expect((await readCatalog(ctx.db, fixture)).calendars).toEqual([]);
    if (change === "reconnect") {
      expect(
        (
          await discoverCatalog(ctx.db, fixture, [
            { items: [initialCatalogCalendar], nextSyncToken: "new-lifetime" },
          ])
        ).ok,
      ).toBe(true);
      expect((await readCatalog(ctx.db, fixture)).calendars[0]?.id).toBe(
        fixture.catalog.calendars[0]?.id,
      );
    }
  },
);
