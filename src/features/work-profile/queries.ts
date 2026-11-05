import { and, asc, eq, gt, ilike, isNull, or, type SQL, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { deals, organizations, persons, pipelines, users, visibilityGroups } from "@/db/schema";
import { dealVisibilityPredicate } from "@/features/permissions/sql";
import type { WorkOptions } from "./contracts";
import { fail } from "./errors";
import { allowed, itemVisibility, type WorkActor } from "./policy";
import { itemDto } from "./read";
import { workItems } from "./schema";
export type ItemFilter = {
  typeId?: string;
  stageId?: string;
  q?: string;
  archived: boolean;
  cursor?: string;
};
export async function queryItems(
  db: Db,
  actor: WorkActor,
  filter: ItemFilter,
  signal: AbortSignal,
) {
  if (!allowed(actor, "work.view")) fail("forbidden");
  const rows = await db
    .select()
    .from(workItems)
    .where(
      and(
        itemVisibility(actor),
        eq(workItems.isArchived, filter.archived),
        filter.typeId !== undefined && filter.typeId !== ""
          ? eq(workItems.typeId, filter.typeId)
          : undefined,
        filter.stageId !== undefined && filter.stageId !== ""
          ? eq(workItems.stageId, filter.stageId)
          : undefined,
        filter.cursor !== undefined && filter.cursor !== ""
          ? gt(workItems.id, filter.cursor)
          : undefined,
        filter.q !== undefined && filter.q !== ""
          ? or(
              ilike(workItems.title, `%${filter.q.replace(/[\\%_]/g, "\\$&")}%`),
              ilike(workItems.description, `%${filter.q.replace(/[\\%_]/g, "\\$&")}%`),
            )
          : undefined,
      ),
    )
    .orderBy(asc(workItems.id))
    .limit(51);
  signal.throwIfAborted();
  return {
    items: rows.slice(0, 50).map(itemDto),
    nextCursor: rows.length > 50 ? (rows[49]?.id ?? null) : null,
  };
}
export async function queryItem(db: Db, actor: WorkActor, id: string, signal: AbortSignal) {
  if (!allowed(actor, "work.view")) fail("forbidden");
  const [row] = await db
    .select()
    .from(workItems)
    .where(and(eq(workItems.id, id), itemVisibility(actor)));
  signal.throwIfAborted();
  if (!row) fail("not_found");
  return itemDto(row);
}
function nativeVisibility(
  actor: WorkActor,
  c: {
    ownerId: SQL;
    visibilityLevel: SQL;
    visibilityGroupId: SQL;
    visibleToUserIds: SQL;
    pipelineVisibilityGroupId?: SQL;
  },
) {
  return dealVisibilityPredicate(
    {
      userId: actor.id,
      isActive: actor.isActive,
      sessionLive: true,
      isAdmin: actor.type === "admin",
      groupIds: [...actor.groupIds],
      managedUserIds: [...(actor.managedUserIds ?? [])],
    },
    { ...c, pipelineVisibilityGroupId: c.pipelineVisibilityGroupId ?? sql`NULL::uuid` },
  );
}
export async function queryOptions(
  db: Db,
  actor: WorkActor,
  signal: AbortSignal,
): Promise<WorkOptions> {
  if (!allowed(actor, "work.view") && !allowed(actor, "work.create")) fail("forbidden");
  const owners = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(
      and(
        eq(users.isActive, true),
        allowed(actor, "work.manage") ? undefined : eq(users.id, actor.id),
      ),
    )
    .orderBy(asc(users.name))
    .limit(250);
  signal.throwIfAborted();
  const orgs = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(
      and(
        isNull(organizations.deletedAt),
        nativeVisibility(actor, {
          ownerId: sql`${organizations.ownerId}`,
          visibilityLevel: sql`${organizations.visibilityLevel}`,
          visibilityGroupId: sql`${organizations.visibilityGroupId}`,
          visibleToUserIds: sql`${organizations.visibleToUserIds}`,
        }),
      ),
    )
    .orderBy(asc(organizations.name))
    .limit(250);
  signal.throwIfAborted();
  const people = await db
    .select({ id: persons.id, name: persons.name })
    .from(persons)
    .where(
      and(
        isNull(persons.deletedAt),
        nativeVisibility(actor, {
          ownerId: sql`${persons.ownerId}`,
          visibilityLevel: sql`${persons.visibilityLevel}`,
          visibilityGroupId: sql`${persons.visibilityGroupId}`,
          visibleToUserIds: sql`${persons.visibleToUserIds}`,
        }),
      ),
    )
    .orderBy(asc(persons.name))
    .limit(250);
  signal.throwIfAborted();
  const opportunities = await db
    .select({ id: deals.id, title: deals.title })
    .from(deals)
    .innerJoin(pipelines, eq(pipelines.id, deals.pipelineId))
    .where(
      and(
        isNull(deals.deletedAt),
        isNull(deals.archivedAt),
        eq(pipelines.isArchived, false),
        nativeVisibility(actor, {
          ownerId: sql`${deals.ownerId}`,
          visibilityLevel: sql`${deals.visibilityLevel}`,
          visibilityGroupId: sql`${deals.visibilityGroupId}`,
          visibleToUserIds: sql`${deals.visibleToUserIds}`,
          pipelineVisibilityGroupId: sql`${pipelines.visibilityGroupId}`,
        }),
      ),
    )
    .orderBy(asc(deals.title))
    .limit(250);
  signal.throwIfAborted();
  const groups = await db
    .select({ id: visibilityGroups.id, name: visibilityGroups.name })
    .from(visibilityGroups)
    .where(
      actor.type === "admin"
        ? undefined
        : sql`${visibilityGroups.id}=ANY(${sql.param([...actor.groupIds])}::uuid[])`,
    )
    .orderBy(asc(visibilityGroups.name))
    .limit(250);
  signal.throwIfAborted();
  return { owners, organizations: orgs, persons: people, deals: opportunities, groups };
}
