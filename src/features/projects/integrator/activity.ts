import { and, desc, eq } from "drizzle-orm";
import { err, ok } from "@/types/result";
import { lockInternalProject, withInternalProjects } from "../access";
import { internalProjectItemEvents as events } from "../profile/schema";
import { internalProjectItems as items } from "../schema";
import { apiJson, apiPage, methodNotAllowed, missing, returned } from "./httpSupport";
import type { Operation } from "./operations";

export async function workItemActivity(
  op: Operation,
  projectId: string,
  itemId: string,
  eventId?: string,
) {
  if (op.request.method !== "GET") return methodNotAllowed();
  const rows = returned(
    await withInternalProjects(op.db, op.actor, op.signal, async (tx, actor) => {
      const access = await lockInternalProject(tx, actor, projectId, "read", "work-items");
      if (!access.ok) return access;
      const { workItemCreatorId } = access.value;
      const [item] = await tx
        .select({ id: items.id })
        .from(items)
        .where(
          and(
            eq(items.projectId, projectId),
            eq(items.id, itemId),
            workItemCreatorId === null ? undefined : eq(items.createdBy, workItemCreatorId),
          ),
        );
      if (item === undefined) return err("project_unavailable" as const);
      const history = await tx
        .select({
          id: events.id,
          actor: events.actorId,
          verb: events.kind,
          recordedAt: events.recordedAt,
        })
        .from(events)
        .where(
          and(
            eq(events.itemId, itemId),
            eventId === undefined ? undefined : eq(events.id, eventId),
          ),
        )
        .orderBy(desc(events.recordedAt), desc(events.id));
      return ok(
        history.map((event) => ({
          id: event.id,
          project: projectId,
          issue: itemId,
          actor: event.actor,
          verb: event.verb,
          created_at: event.recordedAt.toISOString(),
        })),
      );
    }),
  );
  return eventId === undefined ? apiPage(op.url, rows) : apiJson(rows[0] ?? missing());
}
