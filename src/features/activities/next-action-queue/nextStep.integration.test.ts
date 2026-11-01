import { eq } from "drizzle-orm";
import { expect, test } from "vitest";
import { activities, deals } from "@/db/schema";
import { addActivity, addDeal, NOW, page, rowIds, withQueueDb } from "./queue.test-helpers";

test("an undated open activity prevents a false missing-next-step row despite null denormalized date", async () => {
  await withQueueDb(async (f) => {
    const deal = await addDeal(f, { nextActivityAt: null });
    await addActivity(f, { dealId: deal.id, dueAt: null });
    const result = await page(f);
    expect(result.rows).toEqual([]);
    expect(result.counts).toEqual({ overdue: 0, missingNextStep: 0 });
    expect(result.total).toBe(0);
    expect(
      (await f.h.db.select().from(deals).where(eq(deals.id, deal.id)))[0]?.nextActivityAt,
    ).toBeNull();
  });
});

test("a permitted colleague's open linked activity also prevents missing-next-step classification", async () => {
  await withQueueDb(async (f) => {
    const deal = await addDeal(f);
    await addActivity(f, {
      dealId: deal.id,
      assigneeId: f.colleague.id,
      ownerId: f.colleague.id,
      dueAt: new Date("2026-11-02T09:00:00Z"),
    });
    expect((await page(f, { scope: "mine" })).rows).toEqual([]);
    expect((await page(f)).rows).toEqual([]);
  });
});

test("completed and deleted activities do not satisfy the next-step requirement", async () => {
  await withQueueDb(async (f) => {
    const completed = await addDeal(f, { title: "Completed activity only" });
    const deleted = await addDeal(f, { title: "Deleted activity only" });
    await addActivity(f, { dealId: completed.id, done: true, doneAt: NOW });
    await addActivity(f, { dealId: deleted.id, deletedAt: NOW });
    const result = await page(f);
    expect(rowIds(result)).toEqual([completed.id, deleted.id].sort());
    expect(result.counts).toEqual({ overdue: 0, missingNextStep: 2 });
    expect(result.rows.every((row) => row.reason === "missing-next-step")).toBe(true);
  });
});

test("fresh reads follow real creation, completion, relinking and deletion without fabricating work", async () => {
  await withQueueDb(async (f) => {
    const first = await addDeal(f, { title: "First" });
    const second = await addDeal(f, { title: "Second" });
    expect((await page(f)).counts.missingNextStep).toBe(2);
    const activity = await addActivity(f, { dealId: first.id, dueAt: null });
    expect(rowIds(await page(f))).toEqual([second.id]);
    await f.h.db
      .update(activities)
      .set({ dealId: second.id })
      .where(eq(activities.id, activity.id));
    expect(rowIds(await page(f))).toEqual([first.id]);
    await f.h.db
      .update(activities)
      .set({ done: true, doneAt: NOW })
      .where(eq(activities.id, activity.id));
    expect((await page(f)).counts.missingNextStep).toBe(2);
    await f.h.db
      .update(activities)
      .set({ done: false, deletedAt: NOW })
      .where(eq(activities.id, activity.id));
    expect((await page(f)).counts.missingNextStep).toBe(2);
    const stored = await f.h.db.select().from(activities);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      id: activity.id,
      dealId: second.id,
      done: false,
      deletedAt: NOW,
    });
  });
});
