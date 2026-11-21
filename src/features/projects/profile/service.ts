import { and, count, desc, eq, isNull, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Db } from "@/db/client";
import { agencyProjects } from "@/features/agency-projects/schema/agencyProjects";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { ok } from "@/types/result";
import { listInternalProjectScope, withInternalProjects } from "../access";
import { internalProjectItems } from "../schema";
import type {
  ProfileActivityPage,
  ProfileCursor,
  ProfileItemsInput,
  ProfileItemsPage,
  ProfileView,
  ProjectProfileSummary,
} from "./contracts";
import { internalProjectItemEvents } from "./schema";
import { itemSubscribedBy } from "./subscriptions";

const PAGE_SIZE = 50;

function workOfMember(db: Db, memberId: string, view: ProfileView) {
  switch (view) {
    case "assigned":
      return eq(internalProjectItems.assigneeId, memberId);
    case "created":
      return eq(internalProjectItems.createdBy, memberId);
    case "subscribed":
      return itemSubscribedBy(db, memberId);
  }
}

export function readProjectProfileSummary(db: Db, session: NativeSessionRef, signal: AbortSignal) {
  return withInternalProjects<ProjectProfileSummary>(db, session, signal, async (tx, actor) => {
    const item = internalProjectItems;
    const assignedToActor = eq(item.assigneeId, actor.id);
    const createdByActor = eq(item.createdBy, actor.id);
    const subscribedByActor = itemSubscribedBy(tx, actor.id);
    const rows = await tx
      .select({
        status: item.status,
        priority: item.priority,
        assigned: count(sql`CASE WHEN ${assignedToActor} THEN 1 END`),
        created: count(sql`CASE WHEN ${createdByActor} THEN 1 END`),
        subscribed: count(sql`CASE WHEN ${subscribedByActor} THEN 1 END`),
      })
      .from(item)
      .innerJoin(agencyProjects, eq(item.projectId, agencyProjects.id))
      .where(
        and(
          listInternalProjectScope(tx, actor.id),
          isNull(item.archivedAt),
          or(assignedToActor, createdByActor, subscribedByActor),
        ),
      )
      .groupBy(item.status, item.priority);
    const counts = { todo: 0, "in-progress": 0, done: 0 };
    const priorityCounts = { urgent: 0, high: 0, medium: 0, low: 0, none: 0 };
    let createdCount = 0;
    let subscribedCount = 0;
    for (const row of rows) {
      counts[row.status] += row.assigned;
      priorityCounts[row.priority] += row.assigned;
      createdCount += row.created;
      subscribedCount += row.subscribed;
    }
    return ok({
      member: { id: actor.id, name: actor.name },
      counts,
      priorityCounts,
      createdCount,
      subscribedCount,
    });
  });
}

function cursorTimestamp(column: AnyPgColumn) {
  // PostgreSQL timestamps retain microseconds. Keep that precision in both pagination cursors.
  return sql<string>`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

function earlierThanCursor(
  timestamp: AnyPgColumn,
  id: AnyPgColumn,
  cursor: ProfileCursor | undefined,
) {
  return cursor === undefined
    ? undefined
    : sql`(${timestamp}, ${id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`;
}

export function readProjectProfileItems(
  db: Db,
  session: NativeSessionRef,
  view: ProfileView,
  { status, priority, cursor }: ProfileItemsInput,
  signal: AbortSignal,
) {
  return withInternalProjects<ProfileItemsPage>(db, session, signal, async (tx, actor) => {
    const item = internalProjectItems;
    const rows = await tx
      .select({
        id: item.id,
        title: item.title,
        status: item.status,
        priority: item.priority,
        project: { id: agencyProjects.id, title: agencyProjects.title },
        createdAt: cursorTimestamp(item.createdAt),
      })
      .from(item)
      .innerJoin(agencyProjects, eq(item.projectId, agencyProjects.id))
      .where(
        and(
          listInternalProjectScope(tx, actor.id),
          workOfMember(tx, actor.id, view),
          isNull(item.archivedAt),
          status === undefined ? undefined : eq(item.status, status),
          priority === undefined ? undefined : eq(item.priority, priority),
          earlierThanCursor(item.createdAt, item.id, cursor),
        ),
      )
      .orderBy(desc(item.createdAt), desc(item.id))
      .limit(PAGE_SIZE + 1);
    const page = rows.slice(0, PAGE_SIZE);
    const last = page.at(-1);
    return ok({
      member: { id: actor.id, name: actor.name },
      items: page.map(({ id, title, status, priority, project }) => ({
        id,
        title,
        status,
        priority,
        project,
      })),
      nextCursor:
        rows.length > PAGE_SIZE && last !== undefined
          ? { id: last.id, createdAt: last.createdAt }
          : null,
    });
  });
}

export function readProjectProfileActivity(
  db: Db,
  session: NativeSessionRef,
  cursor: ProfileCursor | undefined,
  signal: AbortSignal,
) {
  return withInternalProjects<ProfileActivityPage>(db, session, signal, async (tx, actor) => {
    const item = internalProjectItems;
    const event = internalProjectItemEvents;
    const rows = await tx
      .select({
        id: event.id,
        kind: event.kind,
        recordedAt: cursorTimestamp(event.recordedAt),
        itemId: item.id,
        title: item.title,
        project: { id: agencyProjects.id, title: agencyProjects.title },
      })
      .from(event)
      .innerJoin(item, eq(event.itemId, item.id))
      .innerJoin(agencyProjects, eq(item.projectId, agencyProjects.id))
      .where(
        and(
          listInternalProjectScope(tx, actor.id),
          eq(event.actorId, actor.id),
          earlierThanCursor(event.recordedAt, event.id, cursor),
        ),
      )
      .orderBy(desc(event.recordedAt), desc(event.id))
      .limit(PAGE_SIZE + 1);
    const page = rows.slice(0, PAGE_SIZE);
    const last = page.at(-1);
    return ok({
      member: { id: actor.id, name: actor.name },
      events: page.map(({ id, kind, recordedAt, itemId, title, project }) => ({
        id,
        kind,
        recordedAt,
        item: { id: itemId, title, project },
      })),
      nextCursor:
        rows.length > PAGE_SIZE && last !== undefined
          ? { id: last.id, createdAt: last.recordedAt }
          : null,
    });
  });
}
