import { afterEach, beforeEach, expect, it } from "vitest";
import {
  activities,
  activityReminderIntents,
  activityReminderSettings,
  organizations,
} from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import { makeTestDb } from "@/test/db";
import { updateActivity } from "../../activityUpdate";
import { disconnectCalendarProviderAccount } from "./accounts";
import { connectTestCalendar, calendarTestSignal as signal } from "./accountTestHelpers";
import {
  bindingFixture,
  bindingOk,
  publishBindingCatalog,
  selectCalendar,
  selectedCalendar,
  selectionInput,
  selectionRows,
} from "./calendarBindings.test-helpers";
import { whileProviderBlocked } from "./calendarCatalog.gate-helpers";
import {
  catalogTransport,
  discoverCatalog,
  forbidProviderNetwork,
  initialCatalogCalendar,
} from "./calendarCatalog.test-helpers";
import { nativeSourceFixture } from "./calendarSourceGuard.test-helpers";

let ctx: Awaited<ReturnType<typeof makeTestDb>>;
let network: ReturnType<typeof forbidProviderNetwork>;
beforeEach(async () => {
  ctx = await makeTestDb();
  network = forbidProviderNetwork();
});
afterEach(async () => {
  try {
    await ctx.close();
  } finally {
    network.mockRestore();
  }
});

it("retains binding and local-calendar IDs across idempotent Add, Remove and re-Add", async () => {
  const fixture = await bindingFixture(ctx);
  const added = bindingOk(await selectCalendar(ctx, fixture.userId, selectionInput(fixture)));
  expect(
    bindingOk(
      await selectCalendar(ctx, fixture.userId, selectionInput(fixture, true, added.version)),
    ),
  ).toEqual(added);
  const removed = bindingOk(
    await selectCalendar(ctx, fixture.userId, selectionInput(fixture, false, added.version)),
  );
  expect(removed).toEqual({ ...added, selected: false, version: added.version + 1 });
  expect(
    bindingOk(
      await selectCalendar(ctx, fixture.userId, selectionInput(fixture, false, removed.version)),
    ),
  ).toEqual(removed);
  const readded = bindingOk(
    await selectCalendar(ctx, fixture.userId, selectionInput(fixture, true, removed.version)),
  );
  expect(readded).toEqual({ ...added, version: removed.version + 1 });
  await selectedCalendar(ctx, fixture, readded);
  expect((await selectionRows(ctx)).bindings).toHaveLength(1);
});

it("requires matching binding CAS even for a repeated intent", async () => {
  const fixture = await bindingFixture(ctx);
  const added = bindingOk(await selectCalendar(ctx, fixture.userId, selectionInput(fixture)));
  bindingOk(
    await selectCalendar(ctx, fixture.userId, selectionInput(fixture, false, added.version)),
  );
  const before = await selectionRows(ctx);
  for (const expectedVersion of [null, added.version])
    for (const selected of [true, false])
      expect(
        await selectCalendar(
          ctx,
          fixture.userId,
          selectionInput(fixture, selected, expectedVersion),
        ),
      ).toMatchObject({ ok: false, error: { kind: "conflict" } });
  expect(await selectionRows(ctx)).toEqual(before);
  expect(added.selected).toBe(true);
});

it("allows owner-only Remove while disconnected and with a stale catalog revision", async () => {
  const fixture = await bindingFixture(ctx);
  const added = bindingOk(await selectCalendar(ctx, fixture.userId, selectionInput(fixture)));
  bindingOk(
    await disconnectCalendarProviderAccount(ctx.db, fixture.userId, fixture.accountId, signal()),
  );
  const stranger = await seedUser(ctx.db);
  const input = { ...selectionInput(fixture, false, added.version), expectedCatalogRevision: 0 };
  expect((await selectCalendar(ctx, stranger.id, input)).ok).toBe(false);
  const removed = bindingOk(await selectCalendar(ctx, fixture.userId, input));
  expect(removed).toEqual({ ...added, selected: false, version: added.version + 1 });
  await selectedCalendar(ctx, fixture, removed);
  expect(
    (await selectCalendar(ctx, fixture.userId, selectionInput(fixture, true, removed.version))).ok,
  ).toBe(false);
  expect(network).not.toHaveBeenCalled();
});

it("retains a source tombstone through provider deletion and permits local Remove", async () => {
  const fixture = await bindingFixture(ctx);
  const added = bindingOk(await selectCalendar(ctx, fixture.userId, selectionInput(fixture)));
  const latest = await publishBindingCatalog(ctx, fixture, { deleted: true });
  const removed = bindingOk(
    await selectCalendar(ctx, fixture.userId, selectionInput(fixture, false, added.version)),
  );
  expect(removed).toEqual({ ...added, selected: false, version: added.version + 1 });
  await selectedCalendar(ctx, fixture, removed);
  expect(
    (
      await selectCalendar(ctx, fixture.userId, {
        ...selectionInput(fixture, true, removed.version),
        expectedCatalogRevision: latest.revision,
      })
    ).ok,
  ).toBe(false);
  expect((await selectionRows(ctx)).bindings).toHaveLength(1);
});

it("does not Add from the previous published snapshot while a newer discovery is in flight", async () => {
  const fixture = await bindingFixture(ctx);
  const pages = [{ items: [initialCatalogCalendar], nextSyncToken: "newer-discovery" }];
  const result = await whileProviderBlocked(
    (transport, gateSignal) =>
      discoverCatalog(ctx.db, fixture, pages, { transport, signal: gateSignal }),
    catalogTransport(pages),
    async () => {
      const before = await selectionRows(ctx);
      expect((await selectCalendar(ctx, fixture.userId, selectionInput(fixture))).ok).toBe(false);
      expect(await selectionRows(ctx)).toEqual(before);
    },
  );
  expect(result.ok).toBe(true);
});

it("does not Add using a catalog from an older connection lifetime", async () => {
  const fixture = await bindingFixture(ctx);
  await connectTestCalendar(ctx.db, fixture.userId);
  const before = await selectionRows(ctx);
  expect((await selectCalendar(ctx, fixture.userId, selectionInput(fixture))).ok).toBe(false);
  expect(await selectionRows(ctx)).toEqual(before);
});

it("serializes competing first Adds without duplicate bindings or dedicated calendars", async () => {
  const fixture = await bindingFixture(ctx);
  const before = await selectionRows(ctx);
  const results = await Promise.all([
    selectCalendar(ctx, fixture.userId, selectionInput(fixture)),
    selectCalendar(ctx, fixture.userId, selectionInput(fixture)),
  ]);
  expect(results.filter((result) => result.ok)).toHaveLength(1);
  expect(results.filter((result) => !result.ok)).toEqual([
    { ok: false, error: { kind: "conflict" } },
  ]);
  const after = await selectionRows(ctx);
  expect(after.bindings).toHaveLength(1);
  expect(after.calendars).toHaveLength(before.calendars.length + 1);
});

it("selection changes leave existing native CRM activities, links, revisions and reminder state untouched", async () => {
  const native = await nativeSourceFixture(ctx);
  const [org] = await ctx.db
    .insert(organizations)
    .values({ name: "CRM preservation", ownerId: native.owner.id, visibilityLevel: "owner" })
    .returning();
  expect(org).toBeDefined();
  if (org === undefined) return;
  bindingOk(
    await updateActivity(
      ctx.db,
      native.owner,
      { id: native.nativeEvent.id, expectedVersion: native.nativeEvent.version, orgId: org.id },
      signal(),
    ),
  );
  const before = await ctx.db.select().from(activities).orderBy(activities.id);
  const fixture = await bindingFixture(ctx);
  const added = bindingOk(await selectCalendar(ctx, fixture.userId, selectionInput(fixture)));
  bindingOk(
    await selectCalendar(ctx, fixture.userId, selectionInput(fixture, false, added.version)),
  );
  expect(await ctx.db.select().from(activities).orderBy(activities.id)).toEqual(before);
  expect(await ctx.db.select().from(activityReminderIntents)).toHaveLength(0);
  expect(await ctx.db.select().from(activityReminderSettings)).toHaveLength(0);
});
