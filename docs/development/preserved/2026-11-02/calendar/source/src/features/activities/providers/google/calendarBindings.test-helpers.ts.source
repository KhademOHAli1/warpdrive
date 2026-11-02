import { eq } from "drizzle-orm";
import { expect } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { calendars } from "@/db/schema";
import type { TestDb } from "@/test/db";
import type { Result } from "@/types/result";
import { calendarTestSignal as signal } from "./accountTestHelpers";
import {
  catalogFixture,
  discoverCatalog,
  initialCatalogCalendar,
  readCatalog,
} from "./calendarCatalog.test-helpers";

export interface BindingSelection {
  bindingId: string;
  localCalendarId: string;
  version: number;
  selected: boolean;
}
export interface SelectionInput {
  accountId: string;
  calendarId: string;
  selected: boolean;
  expectedCatalogRevision: number;
  expectedBindingVersion: number | null;
}
export function bindingOk<T, E>(result: Result<T, E>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new AppError(ERROR_IDS.DB_INVARIANT, "calendar binding fixture failed");
  return result.value;
}
export async function bindingFixture(ctx: TestDb, resource: Record<string, unknown> = {}) {
  const fixture = await catalogFixture(ctx.db);
  bindingOk(
    await discoverCatalog(ctx.db, fixture, [
      {
        items: [{ ...initialCatalogCalendar, ...resource }],
        nextSyncToken: "binding-catalog-cursor",
      },
    ]),
  );
  const catalog = await readCatalog(ctx.db, fixture);
  const entry = catalog.calendars.find((row) => row.calendarId === initialCatalogCalendar.id);
  if (entry === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "binding catalog entry missing");
  return { ...fixture, catalog, entry };
}
export type BindingFixture = Awaited<ReturnType<typeof bindingFixture>>;
export function selectionInput(
  fixture: BindingFixture,
  selected = true,
  expectedBindingVersion: number | null = null,
): SelectionInput {
  return {
    accountId: fixture.accountId,
    calendarId: fixture.entry.id,
    selected,
    expectedCatalogRevision: fixture.catalog.revision,
    expectedBindingVersion,
  };
}
export async function selectCalendar(
  ctx: TestDb,
  userId: string,
  input: SelectionInput,
): Promise<Result<BindingSelection, { kind: string }>> {
  const api = await import("./calendarBindings");
  return api.setGoogleCalendarSelection(ctx.db, userId, input, signal());
}
export async function selectedCalendar(
  ctx: TestDb,
  fixture: BindingFixture,
  selection: BindingSelection,
) {
  const [calendar] = await ctx.db
    .select()
    .from(calendars)
    .where(eq(calendars.id, selection.localCalendarId));
  expect(calendar).toBeDefined();
  if (calendar === undefined) throw new AppError(ERROR_IDS.DB_INVARIANT, "bound calendar missing");
  expect(calendar).toMatchObject({
    id: selection.localCalendarId,
    ownerId: fixture.userId,
    isPrimary: false,
    timeZone: "Asia/Tehran",
  });
  const source = await ctx.pool.query<{ source: string }>(
    "SELECT source FROM calendars WHERE id = $1",
    [calendar.id],
  );
  expect(source.rows).toEqual([{ source: "provider" }]);
  return calendar;
}
export async function selectionRows(ctx: TestDb) {
  return {
    calendars: await ctx.db.select().from(calendars).orderBy(calendars.id),
    bindings: (
      await ctx.pool.query<Record<string, unknown>>(
        "SELECT * FROM calendar_provider_bindings ORDER BY id",
      )
    ).rows,
  };
}
export async function publishBindingCatalog(
  ctx: TestDb,
  fixture: BindingFixture,
  resource: Record<string, unknown>,
) {
  bindingOk(
    await discoverCatalog(ctx.db, fixture, [
      {
        items: [{ ...initialCatalogCalendar, ...resource }],
        nextSyncToken: "updated-binding-cursor",
      },
    ]),
  );
  return readCatalog(ctx.db, fixture);
}
