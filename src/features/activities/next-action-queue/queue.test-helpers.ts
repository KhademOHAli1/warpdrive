import { eq } from "drizzle-orm";
import { expect } from "vitest";
import type { PermissionFlagKey } from "@/constants/permissionFlags";
import {
  activities,
  activityTypes,
  deals,
  type NewActivity,
  type NewDeal,
  userPreferences,
} from "@/db/schema";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import type { PermSetUser } from "@/features/permissions/effective";
import { makeTestDb, type TestDb } from "@/test/db";
import type { NextActionQueueInput, NextActionQueuePage } from "./queueTypes";
import { readNextActionQueue } from "./readNextActionQueue";

export const NOW = new Date("2026-10-31T12:00:00.000Z");
export const PAST = new Date("2026-10-30T09:00:00.000Z");
const CREATED = new Date("2026-10-01T09:00:00.000Z");
export const signal = () => AbortSignal.timeout(15_000);

async function fixture(h: TestDb) {
  const viewer = await seedUser(h.db, { name: "نماینده / Vertrieb" });
  const colleague = await seedUser(h.db, { name: "Colleague" });
  const pipe = await seedPipelineWithStages(h.db, ["بررسی / Prüfung"], { name: "مسیر / Prozess" });
  const [type] = await h.db.select().from(activityTypes).where(eq(activityTypes.key, "call"));
  const stage = pipe.stages[0];
  if (type === undefined || stage === undefined) throw new Error("Queue fixture metadata missing");
  return { h, viewer, colleague, pipe, stage, type };
}

export type QueueFixture = Awaited<ReturnType<typeof fixture>>;

export async function withQueueDb(run: (f: QueueFixture) => Promise<void>): Promise<void> {
  const h = await makeTestDb();
  try {
    await run(await fixture(h));
  } finally {
    await h.close();
  }
}

export function actor(f: QueueFixture, patch: Partial<PermSetUser> = {}): PermSetUser {
  return {
    id: f.viewer.id,
    type: "regular",
    isActive: true,
    flags: new Set<PermissionFlagKey>(["activity.create"]),
    groupIds: new Set(),
    managedUserIds: new Set(),
    ...patch,
  };
}

export async function addDeal(f: QueueFixture, patch: Partial<NewDeal> = {}) {
  const [row] = await f.h.db
    .insert(deals)
    .values({
      title: "فرصت / Opportunity",
      ownerId: f.viewer.id,
      visibilityLevel: "all",
      pipelineId: f.pipe.pipeline.id,
      stageId: f.stage.id,
      createdAt: CREATED,
      updatedAt: CREATED,
      ...patch,
    })
    .returning();
  if (row === undefined) throw new Error("Queue deal fixture missing");
  return row;
}

export async function addActivity(f: QueueFixture, patch: Partial<NewActivity> = {}) {
  const [row] = await f.h.db
    .insert(activities)
    .values({
      typeId: f.type.id,
      subject: "پیگیری / Follow up",
      ownerId: f.viewer.id,
      assigneeId: f.viewer.id,
      dueAt: PAST,
      createdAt: CREATED,
      updatedAt: CREATED,
      ...patch,
    })
    .returning();
  if (row === undefined) throw new Error("Queue activity fixture missing");
  return row;
}

export async function setZone(f: QueueFixture, timeZone: string): Promise<void> {
  const values = {
    timezone: timeZone,
    ui: { localePreferences: { locale: "fa", calendar: "persian", timeZone } },
  };
  await f.h.db
    .insert(userPreferences)
    .values({ userId: f.viewer.id, ...values })
    .onConflictDoUpdate({ target: userPreferences.userId, set: values });
}

export async function page(
  f: QueueFixture,
  input: Partial<NextActionQueueInput> = {},
  viewer: PermSetUser = actor(f),
  asOf = NOW,
): Promise<NextActionQueuePage> {
  const result = await readNextActionQueue(
    f.h.db,
    viewer,
    { scope: "all-permitted", limit: 100, offset: 0, ...input },
    signal(),
    asOf,
  );
  expect(result.ok, result.ok ? undefined : result.error.id).toBe(true);
  if (!result.ok) throw result.error;
  return result.value;
}

export function rowIds(result: NextActionQueuePage): string[] {
  return result.rows.map((row) => row.id).sort();
}
