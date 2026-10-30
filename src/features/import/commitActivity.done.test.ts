import { eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { afterEach, expect, it, vi } from "vitest";
import { activities, deals } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { mapExternal, runActivity, seedDeal } from "./activityImport.testHelpers";
import { adminActorFor } from "./pipedriveImport.testHelpers";

const BOSS_KEY = Symbol.for("warpdrive.jobs.boss");
const setBoss = (boss: PgBoss | null) => {
  (globalThis as { [BOSS_KEY]?: PgBoss | null })[BOSS_KEY] = boss;
};
afterEach(() => setBoss(null));

const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const DAY = 86_400_000;

it("keeps the historical done time and reflects it in the deal's activity dates", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const deal = await seedDeal(db, user.id, "Won deal");
    await mapExternal(db, user.id, "deal", "1", deal.id);
    const doneAt = "2024-03-05T10:00:00.000Z";
    const r = await runActivity(db, adminActorFor(user.id), {
      dealPipedriveId: "1",
      done: true,
      doneAt,
    });
    expect(r.outcome.ok && r.outcome.value.status).toBe("imported");
    const [a] = await db.select().from(activities);
    expect(a?.done).toBe(true);
    expect(a?.doneAt?.toISOString()).toBe(doneAt);
    const [d] = await db.select().from(deals).where(eq(deals.id, deal.id));
    expect(d?.lastActivityAt?.toISOString()).toBe(doneAt);
  });
});

it("stamps now when done has no done time", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const before = Date.now();
    await runActivity(db, adminActorFor(user.id), { done: true });
    const [a] = await db.select().from(activities);
    expect(a?.doneAt?.getTime()).toBeGreaterThanOrEqual(before);
  });
});

it("schedules no reminder for an overdue open activity and one for a future activity", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const send = vi.fn().mockResolvedValue(undefined);
    setBoss({ send } as unknown as PgBoss);
    await runActivity(db, adminActorFor(user.id), { dueAt: iso(-DAY) });
    expect(send).not.toHaveBeenCalled();
    await runActivity(db, adminActorFor(user.id), { dueAt: iso(DAY) });
    expect(send).toHaveBeenCalledTimes(1);
  });
});

it("schedules no reminder for a done activity due in the future", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const send = vi.fn().mockResolvedValue(undefined);
    setBoss({ send } as unknown as PgBoss);
    await runActivity(db, adminActorFor(user.id), { dueAt: iso(DAY), done: true });
    expect(send).not.toHaveBeenCalled();
  });
});

it("treats an activity due within the lead time and a minute as overdue", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const send = vi.fn().mockResolvedValue(undefined);
    setBoss({ send } as unknown as PgBoss);
    await runActivity(db, adminActorFor(user.id), { dueAt: iso(5 * 60_000) });
    expect(send).not.toHaveBeenCalled();
  });
});
