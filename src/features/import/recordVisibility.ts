import { and, eq, inArray, isNull } from "drizzle-orm";
import { activities, deals, leads, notes, organizations, persons, pipelines } from "@/db/schema";
import { resolveActivityVisibility } from "@/features/activities/visibility";
import { leadVisibilityClause } from "@/features/leads/visibility";
import { canSee } from "@/features/permissions/canSee";
import type { AuthUser } from "@/features/permissions/types";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import type { ImportActor } from "./commit";
import { toEntityCreateSession } from "./commitHelpers";

export type ViewableEntity = "person" | "organization" | "deal" | "activity" | "lead" | "note";

export type LiveVisibility = Map<string, boolean>;

async function contactVisibility(
  db: DbOrTx,
  actor: AuthUser,
  entity: "person" | "organization",
  ids: string[],
): Promise<LiveVisibility> {
  const table = entity === "person" ? persons : organizations;
  const rows = await db
    .select()
    .from(table)
    .where(and(inArray(table.id, ids), isNull(table.deletedAt)));
  return new Map(
    rows.map((r) => [
      r.id,
      canSee(actor, {
        kind: entity,
        ownerId: r.ownerId,
        visibilityLevel: r.visibilityLevel,
        visibilityGroupId: r.visibilityGroupId,
        visibleToUserIds: r.visibleToUserIds,
      }),
    ]),
  );
}

async function dealVisibility(db: DbOrTx, actor: AuthUser, ids: string[]): Promise<LiveVisibility> {
  const rows = await db
    .select({ deal: deals, groupId: pipelines.visibilityGroupId, archived: pipelines.isArchived })
    .from(deals)
    .innerJoin(pipelines, eq(pipelines.id, deals.pipelineId))
    .where(and(inArray(deals.id, ids), isNull(deals.deletedAt)));
  return new Map(
    rows.map(({ deal, groupId, archived }) => [
      deal.id,
      archived === false &&
        canSee(actor, {
          kind: "deal",
          ownerId: deal.ownerId,
          visibilityLevel: deal.visibilityLevel,
          visibilityGroupId: deal.visibilityGroupId,
          visibleToUserIds: deal.visibleToUserIds,
          pipelineVisibilityGroupId: groupId,
        }),
    ]),
  );
}

async function activityVisibility(
  db: DbOrTx,
  actor: AuthUser,
  ids: string[],
  signal: AbortSignal,
): Promise<LiveVisibility> {
  const rows = await db
    .select()
    .from(activities)
    .where(and(inArray(activities.id, ids), isNull(activities.deletedAt)));
  const out: LiveVisibility = new Map();
  for (const row of rows) {
    const record = await resolveActivityVisibility(db, row, signal);
    out.set(row.id, record !== null && canSee(actor, record));
  }
  return out;
}

async function leadVisibility(
  db: DbOrTx,
  actor: ImportActor,
  ids: string[],
): Promise<LiveVisibility> {
  const live = await db
    .select({ id: leads.id })
    .from(leads)
    .where(and(inArray(leads.id, ids), isNull(leads.deletedAt)));
  const seen = await db
    .select({ id: leads.id })
    .from(leads)
    .where(
      and(
        inArray(leads.id, ids),
        isNull(leads.deletedAt),
        leadVisibilityClause(toEntityCreateSession(actor)),
      ),
    );
  const seenIds = new Set(seen.map((r) => r.id));
  return new Map(live.map((r) => [r.id, seenIds.has(r.id)]));
}

async function noteVisibility(
  db: DbOrTx,
  actor: ImportActor,
  ids: string[],
  signal: AbortSignal,
): Promise<LiveVisibility> {
  const rows = await db
    .select({ id: notes.id, entityType: notes.entityType, entityId: notes.entityId })
    .from(notes)
    .where(and(inArray(notes.id, ids), isNull(notes.deletedAt)));
  const parents = new Map<string, boolean>();
  for (const type of ["deal", "person", "organization", "lead"] as const) {
    const parentIds = [
      ...new Set(rows.filter((n) => n.entityType === type).map((n) => n.entityId)),
    ];
    if (parentIds.length === 0) continue;
    const seen = await liveVisibility(db, actor, type, parentIds, signal);
    for (const [id, visible] of seen) parents.set(`${type}:${id}`, visible);
  }
  return new Map(rows.map((n) => [n.id, parents.get(`${n.entityType}:${n.entityId}`) === true]));
}

export async function liveVisibility(
  db: DbOrTx,
  actor: ImportActor,
  entity: ViewableEntity,
  ids: string[],
  signal: AbortSignal,
): Promise<LiveVisibility> {
  signal.throwIfAborted();
  if (ids.length === 0) return new Map();
  switch (entity) {
    case "person":
    case "organization":
      return contactVisibility(db, actor, entity, ids);
    case "deal":
      return dealVisibility(db, actor, ids);
    case "activity":
      return activityVisibility(db, actor, ids, signal);
    case "lead":
      return leadVisibility(db, actor, ids);
    case "note":
      return noteVisibility(db, actor, ids, signal);
  }
}
