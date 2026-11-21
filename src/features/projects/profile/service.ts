import { and, count, desc, eq, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { agencyProjects } from "@/features/agency-projects/schema/agencyProjects";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { ok } from "@/types/result";
import { listInternalProjectScope, withInternalProjects } from "../access";
import { internalProjectItems } from "../schema";
import type {
  ProfileItemsInput,
  ProfileItemsPage,
  ProfileView,
  ProjectProfileSummary,
} from "./contracts";

const PAGE_SIZE = 50;

function workOfMember(db: Db, memberId: string, view: ProfileView) {
  const personField =
    view === "assigned" ? internalProjectItems.assigneeId : internalProjectItems.createdBy;
  return and(eq(personField, memberId), listInternalProjectScope(db, memberId));
}

export function readProjectProfileSummary(db: Db, session: NativeSessionRef, signal: AbortSignal) {
  return withInternalProjects<ProjectProfileSummary>(db, session, signal, async (tx, actor) => {
    const item = internalProjectItems;
    const assignedToActor = eq(item.assigneeId, actor.id);
    const createdByActor = eq(item.createdBy, actor.id);
    const rows = await tx
      .select({
        status: item.status,
        priority: item.priority,
        assigned: count(sql`CASE WHEN ${assignedToActor} THEN 1 END`),
        created: count(sql`CASE WHEN ${createdByActor} THEN 1 END`),
      })
      .from(item)
      .innerJoin(agencyProjects, eq(item.projectId, agencyProjects.id))
      .where(and(listInternalProjectScope(tx, actor.id), or(assignedToActor, createdByActor)))
      .groupBy(item.status, item.priority);
    const counts = { todo: 0, "in-progress": 0, done: 0 };
    const priorityCounts = { urgent: 0, high: 0, medium: 0, low: 0, none: 0 };
    let createdCount = 0;
    for (const row of rows) {
      counts[row.status] += row.assigned;
      priorityCounts[row.priority] += row.assigned;
      createdCount += row.created;
    }
    return ok({
      member: { id: actor.id, name: actor.name },
      counts,
      priorityCounts,
      createdCount,
    });
  });
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
    // PostgreSQL timestamps retain microseconds. Keep that precision in the pagination cursor.
    const createdAt = sql<string>`to_char(${item.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
    const rows = await tx
      .select({
        id: item.id,
        title: item.title,
        status: item.status,
        priority: item.priority,
        project: { id: agencyProjects.id, title: agencyProjects.title },
        createdAt,
      })
      .from(item)
      .innerJoin(agencyProjects, eq(item.projectId, agencyProjects.id))
      .where(
        and(
          workOfMember(tx, actor.id, view),
          status === undefined ? undefined : eq(item.status, status),
          priority === undefined ? undefined : eq(item.priority, priority),
          cursor === undefined
            ? undefined
            : sql`(${item.createdAt}, ${item.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`,
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
