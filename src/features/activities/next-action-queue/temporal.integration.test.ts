import { expect, test } from "vitest";
import { activities } from "@/db/schema";
import { isActivityOverdue } from "../overdue";
import {
  addActivity,
  NOW,
  page,
  type QueueFixture,
  rowIds,
  setZone,
  withQueueDb,
} from "./queue.test-helpers";

async function canonicalIds(f: QueueFixture, now: Date, zone: string): Promise<string[]> {
  const stored = await f.h.db.select().from(activities);
  return stored
    .filter(
      (row) =>
        row.deletedAt === null &&
        isActivityOverdue(
          row.dueAt,
          row.allDay,
          row.done,
          now.getTime(),
          zone,
          row.dueDate,
          row.endDate,
          row.endAt,
        ),
    )
    .map((row) => row.id)
    .sort();
}

test("timed work is overdue before the exact server instant, including earlier today", async () => {
  await withQueueDb(async (f) => {
    await setZone(f, "Europe/Berlin");
    const earlier = await addActivity(f, { dueAt: new Date(NOW.getTime() - 1) });
    await addActivity(f, { dueAt: NOW });
    await addActivity(f, { dueAt: new Date(NOW.getTime() + 1) });
    await addActivity(f, { dueAt: null });
    await addActivity(f, { done: true, doneAt: NOW });
    const result = await page(f);
    expect(rowIds(result)).toEqual([earlier.id]);
    expect(result.asOf).toBe(NOW.toISOString());
    expect(result.timeZone).toBe("Europe/Berlin");
    expect(result.counts).toEqual({ overdue: 1, missingNextStep: 0 });
  });
});

test("canonical all-day work becomes overdue only after its final civil day", async () => {
  await withQueueDb(async (f) => {
    await setZone(f, "Europe/Berlin");
    const yesterday = await addActivity(f, {
      allDay: true,
      dueDate: "2026-10-30",
      dueAt: new Date("2026-10-30T00:00:00Z"),
    });
    await addActivity(f, {
      allDay: true,
      dueDate: "2026-10-31",
      dueAt: new Date("2026-10-31T00:00:00Z"),
    });
    await addActivity(f, {
      allDay: true,
      dueDate: "2026-10-29",
      endDate: "2026-10-31",
      dueAt: new Date("2026-10-29T00:00:00Z"),
      endAt: new Date("2026-10-31T00:00:00Z"),
    });
    const multiDay = await addActivity(f, {
      allDay: true,
      dueDate: "2026-10-28",
      endDate: "2026-10-30",
      dueAt: new Date("2026-10-28T00:00:00Z"),
      endAt: new Date("2026-10-30T00:00:00Z"),
    });
    const result = await page(f);
    expect(rowIds(result)).toEqual([yesterday.id, multiDay.id].sort());
    expect(rowIds(result)).toEqual(await canonicalIds(f, NOW, "Europe/Berlin"));
    const row = result.rows.find((item) => item.id === multiDay.id);
    expect(row).toMatchObject({ allDay: true, dueDate: "2026-10-28", endDate: "2026-10-30" });
  });
});

test("saved account zone distinguishes Tehran midnight from the same Berlin instant", async () => {
  await withQueueDb(async (f) => {
    const midnight = new Date("2026-10-31T20:45:00Z");
    const allDay = await addActivity(f, {
      allDay: true,
      dueDate: "2026-10-31",
      dueAt: new Date("2026-10-31T00:00:00Z"),
    });
    const timed = await addActivity(f, { dueAt: new Date("2026-10-31T20:00:00Z") });
    await setZone(f, "Asia/Tehran");
    const tehran = await page(f, {}, undefined, midnight);
    expect(tehran.timeZone).toBe("Asia/Tehran");
    expect(rowIds(tehran)).toEqual([allDay.id, timed.id].sort());
    await setZone(f, "Europe/Berlin");
    const berlin = await page(f, {}, undefined, midnight);
    expect(berlin.timeZone).toBe("Europe/Berlin");
    expect(rowIds(berlin)).toEqual([timed.id]);
  });
});

test("Berlin DST and legacy all-day placeholders exactly match canonical overdue semantics", async () => {
  await withQueueDb(async (f) => {
    await setZone(f, "Europe/Berlin");
    const foldedNow = new Date("2026-10-25T01:30:00Z");
    await addActivity(f, {
      allDay: true,
      dueDate: null,
      endDate: null,
      dueAt: new Date("2026-10-24T22:30:00Z"),
    });
    await addActivity(f, {
      allDay: true,
      dueDate: "2026-10-24",
      dueAt: new Date("2026-10-24T22:30:00Z"),
    });
    await addActivity(f, {
      allDay: true,
      dueDate: null,
      endDate: null,
      dueAt: new Date("2026-10-23T22:30:00Z"),
      endAt: new Date("2026-10-25T01:30:00Z"),
    });
    await addActivity(f, { dueAt: new Date("2026-10-25T00:30:00Z") });
    await addActivity(f, { dueAt: foldedNow });
    for (const now of [foldedNow, new Date("2026-10-26T00:30:00Z")]) {
      const result = await page(f, {}, undefined, now);
      expect(rowIds(result)).toEqual(await canonicalIds(f, now, "Europe/Berlin"));
      expect(result.asOf).toBe(now.toISOString());
    }
  });
});
