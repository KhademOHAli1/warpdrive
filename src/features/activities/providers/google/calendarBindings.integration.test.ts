import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import { calendars, users } from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import { makeTestDb } from "@/test/db";
import { connectTestCalendar } from "./accountTestHelpers";
import {
  bindingFixture,
  bindingOk,
  publishBindingCatalog,
  selectCalendar,
  selectedCalendar,
  selectionInput,
  selectionRows,
} from "./calendarBindings.test-helpers";
import {
  discoverCatalog,
  forbidProviderNetwork,
  initialCatalogCalendar,
  readCatalog,
} from "./calendarCatalog.test-helpers";

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

it.each(["reader", "writer", "owner", "writerWithoutPrivateAccess"])(
  "selects a current %s resource into a dedicated non-primary provider calendar",
  async (accessRole) => {
    const fixture = await bindingFixture(ctx, { accessRole });
    const before = await ctx.db.select().from(calendars);
    const selected = bindingOk(await selectCalendar(ctx, fixture.userId, selectionInput(fixture)));
    expect(selected).toMatchObject({ selected: true, version: 1 });
    expect(before.map((row) => row.id)).not.toContain(selected.localCalendarId);
    await selectedCalendar(ctx, fixture, selected);
    expect(await ctx.db.select().from(calendars)).toHaveLength(before.length + 1);
    const catalog = await readCatalog(ctx.db, fixture);
    expect(catalog.calendars.find((row) => row.id === fixture.entry.id)?.selection).toEqual(
      selected,
    );
    expect(network).not.toHaveBeenCalled();
  },
);

it.each([
  { label: "free/busy only", resource: { accessRole: "freeBusyReader" } },
  { label: "no access", resource: { accessRole: "none" } },
  { label: "missing role", resource: { accessRole: undefined } },
  { label: "deleted", resource: { deleted: true } },
  { label: "invalid zone", resource: { timeZone: "Invalid/Provider_Zone" } },
  { label: "missing zone", resource: { timeZone: undefined } },
])("does not Add a $label resource or create an orphan local calendar", async ({ resource }) => {
  const fixture = await bindingFixture(ctx, resource);
  const before = await selectionRows(ctx);
  expect((await selectCalendar(ctx, fixture.userId, selectionInput(fixture))).ok).toBe(false);
  expect(await selectionRows(ctx)).toEqual(before);
});

it.each(["localCalendarId", "ownerId"])(
  "rejects client-injected %s instead of accepting a native target or owner",
  async (field) => {
    const fixture = await bindingFixture(ctx);
    const stranger = await seedUser(ctx.db);
    const [native] = await ctx.db
      .insert(calendars)
      .values({ ownerId: fixture.userId, name: "Existing native", timeZone: "UTC" })
      .returning();
    expect(native).toBeDefined();
    const before = await selectionRows(ctx);
    const input = {
      ...selectionInput(fixture),
      [field]: field === "ownerId" ? stranger.id : native?.id,
    };
    expect((await selectCalendar(ctx, fixture.userId, input)).ok).toBe(false);
    expect(await selectionRows(ctx)).toEqual(before);
  },
);

it.each(["foreign", "inactive"])(
  "denies Add for a %s owner without changing native or binding rows",
  async (kind) => {
    const fixture = await bindingFixture(ctx);
    const stranger = await seedUser(ctx.db);
    if (kind === "inactive")
      await ctx.db.update(users).set({ isActive: false }).where(eq(users.id, fixture.userId));
    const before = await selectionRows(ctx);
    expect(
      (
        await selectCalendar(
          ctx,
          kind === "foreign" ? stranger.id : fixture.userId,
          selectionInput(fixture),
        )
      ).ok,
    ).toBe(false);
    expect(await selectionRows(ctx)).toEqual(before);
  },
);

it("rejects a stale published catalog revision before creating any local calendar", async () => {
  const fixture = await bindingFixture(ctx);
  await publishBindingCatalog(ctx, fixture, { summary: "Newer catalog" });
  const before = await selectionRows(ctx);
  expect(await selectCalendar(ctx, fixture.userId, selectionInput(fixture))).toMatchObject({
    ok: false,
    error: { kind: "conflict" },
  });
  expect(await selectionRows(ctx)).toEqual(before);
});

it("cannot select another owned account's catalog row through the first account's authority", async () => {
  const fixture = await bindingFixture(ctx);
  const secondAccount = await connectTestCalendar(ctx.db, fixture.userId, {
    subject: "second-calendar-subject",
    email: "second@example.invalid",
  });
  const second = { userId: fixture.userId, accountId: secondAccount.accountId };
  bindingOk(
    await discoverCatalog(ctx.db, second, [
      { items: [initialCatalogCalendar], nextSyncToken: "second-account-cursor" },
    ]),
  );
  const otherCatalog = await readCatalog(ctx.db, second);
  const entry = otherCatalog.calendars[0];
  expect(entry).toBeDefined();
  if (entry === undefined) return;
  const before = await selectionRows(ctx);
  expect(
    (
      await selectCalendar(ctx, fixture.userId, {
        ...selectionInput(fixture),
        calendarId: entry.id,
      })
    ).ok,
  ).toBe(false);
  expect(await selectionRows(ctx)).toEqual(before);
});

it("rolls back the dedicated calendar when the real binding insert fails", async () => {
  const fixture = await bindingFixture(ctx);
  const before = await selectionRows(ctx);
  await ctx.pool.query(
    "CREATE FUNCTION test_reject_calendar_binding() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic binding insert fault' USING ERRCODE = '23514'; END; $$",
  );
  try {
    await ctx.pool.query(
      "CREATE TRIGGER test_reject_calendar_binding BEFORE INSERT ON calendar_provider_bindings FOR EACH ROW EXECUTE FUNCTION test_reject_calendar_binding()",
    );
    try {
      expect(await selectCalendar(ctx, fixture.userId, selectionInput(fixture))).toMatchObject({
        ok: false,
        error: { kind: "storage" },
      });
      expect(await selectionRows(ctx)).toEqual(before);
    } finally {
      await ctx.pool.query(
        "DROP TRIGGER IF EXISTS test_reject_calendar_binding ON calendar_provider_bindings",
      );
    }
  } finally {
    await ctx.pool.query("DROP FUNCTION IF EXISTS test_reject_calendar_binding()");
  }
});
