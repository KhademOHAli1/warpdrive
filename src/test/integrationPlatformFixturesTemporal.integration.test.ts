import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, test } from "vitest";
import { activities } from "@/db/schema";
import { composeDueAt } from "@/features/activities/activityTime";
import { makeTestDb, type TestDb } from "@/test/db";
import { createIntegrationPlatformFixtures } from "./integrationPlatformFixtures";

let h: TestDb;
beforeEach(async () => {
  h = await makeTestDb();
});
afterEach(async () => {
  await h.close();
});
const signal = () => AbortSignal.timeout(10_000);

test("Nowruz date-only records round-trip a canonical Gregorian civil date and Tehran anchor", async () => {
  const result = await createIntegrationPlatformFixtures(
    h,
    { namespace: "nowruz", now: new Date("2026-10-31T12:00Z") },
    signal(),
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const f = result.value;
  const [row] = await h.db
    .select()
    .from(activities)
    .where(eq(activities.id, f.activities.tehranDateOnly));
  expect(row?.allDay).toBe(true);
  expect(row?.dueDate).toBe("2026-03-21");
  expect(row?.endDate).toBe("2026-03-22");
  expect(row?.dueAt?.toISOString()).toBe("2026-03-20T20:30:00.000Z");
  expect(composeDueAt(f.boundaries.nowruz.gregorian, "", "Asia/Tehran").iso).toBe(
    row?.dueAt?.toISOString(),
  );
  const persian = new Intl.DateTimeFormat("en", {
    calendar: "persian",
    numberingSystem: "latn",
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(`${f.boundaries.nowruz.gregorian}T12:00Z`));
  expect(persian.find((part) => part.type === "year")?.value).toBe("1405");
  expect(persian.find((part) => part.type === "month")?.value).toBe("01");
  expect(persian.find((part) => part.type === "day")?.value).toBe("01");
});

test("Berlin repeated-hour fixtures retain distinct instants and the spring gap stays explicitly invalid", async () => {
  const result = await createIntegrationPlatformFixtures(
    h,
    { namespace: "dst", now: new Date("2026-10-31T12:00Z") },
    signal(),
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const f = result.value;
  const [earlier] = await h.db
    .select()
    .from(activities)
    .where(eq(activities.id, f.activities.berlinFoldEarlier));
  const [later] = await h.db
    .select()
    .from(activities)
    .where(eq(activities.id, f.activities.berlinFoldLater));
  expect(earlier?.dueAt?.toISOString()).toBe("2026-10-25T00:30:00.000Z");
  expect(later?.dueAt?.toISOString()).toBe("2026-10-25T01:30:00.000Z");
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  expect(clock.format(earlier?.dueAt ?? new Date(0))).toBe("02:30");
  expect(clock.format(later?.dueAt ?? new Date(0))).toBe("02:30");
  expect(() =>
    composeDueAt(f.boundaries.berlinGap.date, f.boundaries.berlinGap.invalidTime, "Europe/Berlin"),
  ).toThrow("nonexistent activity wall time");
  expect(clock.format(new Date(f.boundaries.berlinGap.before))).toBe("01:59");
  expect(clock.format(new Date(f.boundaries.berlinGap.after))).toBe("03:00");
});
