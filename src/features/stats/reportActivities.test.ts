// @vitest-environment node
import { describe, expect, test } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import type { PermSetUser } from "@/features/permissions/effective";
import type { DashboardFilters } from "@/types/stats";
import { activitiesPerformance } from "./activitiesPerformance";

async function fixture(db: Db) {
  const user = await seedUser(db);
  const [type] = await db
    .insert(schema.activityTypes)
    .values({
      key: "report-call",
      name: "Report call",
    })
    .returning();
  if (type === undefined) throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "Missing activity type");
  const actor: PermSetUser = {
    id: user.id,
    type: "regular",
    isActive: true,
    groupIds: new Set(),
    flags: new Set(),
  };
  const filters: DashboardFilters = {
    pipelineId: null,
    owners: { everyone: false, ids: [user.id] },
    from: "2026-11-05",
    to: "2026-11-05",
    timeZone: "America/Los_Angeles",
  };
  const base = { typeId: type.id, ownerId: user.id, assigneeId: user.id, done: false };
  const read = (day: string) =>
    activitiesPerformance(
      db,
      actor,
      { ...filters, from: day, to: day },
      AbortSignal.timeout(10_000),
    );
  return { base, read };
}

describe("report scheduled and undated activity dates", () => {
  test("keeps a canonical all-day civil date while projecting timed UTC midnight to the viewer day", async () => {
    await withTestDb(async (db) => {
      const f = await fixture(db);
      const anchor = new Date("2026-11-05T00:00:00Z");
      await db.insert(schema.activities).values([
        {
          ...f.base,
          subject: "All day November 5",
          allDay: true,
          dueDate: "2026-11-05",
          dueAt: anchor,
        },
        {
          ...f.base,
          subject: "Timed November 4 locally",
          allDay: false,
          dueDate: null,
          dueAt: anchor,
        },
      ]);
      expect(await f.read("2026-11-05")).toMatchObject({ scheduled: 1, undated: 0 });
      expect(await f.read("2026-11-04")).toMatchObject({ scheduled: 1, undated: 0 });
    });
  });

  test("schedules a canonical civil date with no compatibility anchor and does not count it as undated", async () => {
    await withTestDb(async (db) => {
      const f = await fixture(db);
      await db.insert(schema.activities).values([
        {
          ...f.base,
          subject: "Date without anchor",
          allDay: true,
          dueDate: "2026-11-05",
          dueAt: null,
        },
        { ...f.base, subject: "Truly undated", allDay: true, dueDate: null, dueAt: null },
      ]);
      expect(await f.read("2026-11-05")).toMatchObject({ scheduled: 1, undated: 1 });
      expect(await f.read("2026-11-04")).toMatchObject({ scheduled: 0, undated: 1 });
    });
  });
});
