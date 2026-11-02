import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import {
  activities,
  activityTypes,
  deals,
  permissionSets,
  stages,
  userPreferences,
  visibilityGroups,
} from "@/db/schema";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { fixtureIo } from "./integrationPlatformFixturesIo";
import {
  type IntegrationFixtureCore,
  integrationFixtureBoundaries,
  integrationFixturePreferences,
} from "./integrationPlatformFixturesModels";

export async function seedIntegrationFixtureRecords(
  db: Db,
  namespace: string,
  now: Date,
  signal: AbortSignal,
): Promise<IntegrationFixtureCore> {
  const permissionSetId = randomUUID();
  await fixtureIo(
    () =>
      db.insert(permissionSets).values({
        id: permissionSetId,
        name: `fixture:${namespace}:member`,
        flags: { "deal.create": true, "deal.edit_own": true },
        createdAt: now,
        updatedAt: now,
      }),
    signal,
  );
  const seed = (
    key: string,
    name: string,
    operationSignal: AbortSignal,
    isAdmin = false,
    isActive = true,
  ) =>
    fixtureIo(
      () =>
        seedUser(db, {
          email: `fixture.${namespace}.${key}@example.test`,
          googleSub: `fixture:${namespace}:${key}`,
          name,
          isAdmin,
          isActive,
          permissionSetId: isAdmin ? null : permissionSetId,
          createdAt: now,
          updatedAt: now,
        }),
      operationSignal,
    );
  const admin = await seed("admin", "مدیر آزمایشی", signal, true);
  const member = await seed("member", "Testmitglied", signal);
  const outsider = await seed("outsider", "Synthetic colleague", signal);
  const inactive = await seed("inactive", "Inactive fixture", signal, false, false);
  const restrictedGroupId = randomUUID();
  await fixtureIo(
    () =>
      db.insert(visibilityGroups).values({
        id: restrictedGroupId,
        name: `fixture:${namespace}:restricted`,
        createdAt: now,
        updatedAt: now,
      }),
    signal,
  );
  const open = await fixtureIo(
    () =>
      seedPipelineWithStages(db, ["Synthetic stage"], {
        name: `fixture:${namespace}:open`,
        createdAt: now,
        updatedAt: now,
      }),
    signal,
  );
  const restricted = await fixtureIo(
    () =>
      seedPipelineWithStages(db, ["Restricted stage"], {
        name: `fixture:${namespace}:restricted`,
        visibilityGroupId: restrictedGroupId,
        createdAt: now,
        updatedAt: now,
      }),
    signal,
  );
  const openStage = open.stages[0];
  const restrictedStage = restricted.stages[0];
  if (openStage === undefined || restrictedStage === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "fixture stage missing");
  for (const pipelineId of [open.pipeline.id, restricted.pipeline.id])
    await fixtureIo(
      () =>
        db
          .update(stages)
          .set({ createdAt: now, updatedAt: now })
          .where(eq(stages.pipelineId, pipelineId)),
      signal,
    );
  const [visible, hidden, restrictedDeal] = await fixtureIo(
    () =>
      db
        .insert(deals)
        .values([
          {
            title: "فرصت آزمایشی قابل مشاهده",
            ownerId: member.id,
            visibilityLevel: "owner",
            pipelineId: open.pipeline.id,
            stageId: openStage.id,
            stageEnteredAt: now,
            createdAt: now,
            updatedAt: now,
          },
          {
            title: "Hidden synthetic opportunity",
            ownerId: outsider.id,
            visibilityLevel: "owner",
            pipelineId: open.pipeline.id,
            stageId: openStage.id,
            stageEnteredAt: now,
            createdAt: now,
            updatedAt: now,
          },
          {
            title: "Restricted pipeline fixture",
            ownerId: member.id,
            visibilityLevel: "all",
            pipelineId: restricted.pipeline.id,
            stageId: restrictedStage.id,
            stageEnteredAt: now,
            createdAt: now,
            updatedAt: now,
          },
        ])
        .returning(),
    signal,
  );
  if (visible === undefined || hidden === undefined || restrictedDeal === undefined)
    throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "fixture deal rows missing");
  const actors = { admin, member, outsider, inactive };
  for (const key of ["admin", "member", "outsider"] as const)
    await fixtureIo(
      () =>
        db.insert(userPreferences).values({
          userId: actors[key].id,
          timezone: integrationFixturePreferences[key].timeZone,
          ui: { localePreferences: integrationFixturePreferences[key] },
          updatedAt: now,
        }),
      signal,
    );
  const [type] = await fixtureIo(
    () =>
      db
        .select({ id: activityTypes.id })
        .from(activityTypes)
        .where(eq(activityTypes.key, "meeting")),
    signal,
  );
  if (type === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "fixture meeting type missing");
  const [dateOnly, earlier, later] = await fixtureIo(
    () =>
      db
        .insert(activities)
        .values([
          {
            typeId: type.id,
            subject: "برنامه‌ریزی نوروز",
            ownerId: member.id,
            assigneeId: member.id,
            dealId: visible.id,
            allDay: true,
            dueDate: integrationFixtureBoundaries.nowruz.gregorian,
            endDate: integrationFixtureBoundaries.nowruz.inclusiveEnd,
            dueAt: new Date(integrationFixtureBoundaries.nowruz.tehranAnchor),
            endAt: new Date(integrationFixtureBoundaries.nowruz.endAnchor),
            createdAt: now,
            updatedAt: now,
          },
          {
            typeId: type.id,
            subject: "Wiederholte Stunde, früher",
            ownerId: member.id,
            assigneeId: member.id,
            dueAt: new Date(integrationFixtureBoundaries.berlinFold.earlier),
            createdAt: now,
            updatedAt: now,
          },
          {
            typeId: type.id,
            subject: "Repeated hour, later",
            ownerId: outsider.id,
            assigneeId: outsider.id,
            dueAt: new Date(integrationFixtureBoundaries.berlinFold.later),
            createdAt: now,
            updatedAt: now,
          },
        ])
        .returning({ id: activities.id }),
    signal,
  );
  if (dateOnly === undefined || earlier === undefined || later === undefined)
    throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "fixture activity rows missing");
  return {
    users: actors,
    deals: { visible, hidden, restricted: restrictedDeal },
    restrictedGroupId,
    activities: {
      tehranDateOnly: dateOnly.id,
      berlinFoldEarlier: earlier.id,
      berlinFoldLater: later.id,
    },
    preferences: integrationFixturePreferences,
    boundaries: integrationFixtureBoundaries,
  };
}
