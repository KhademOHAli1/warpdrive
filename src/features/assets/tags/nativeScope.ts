import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { directorySites } from "@/features/locations/schema";
import { lockDirectory } from "@/features/locations/service";
import {
  readSiteAssetTargets,
  type SiteAssetTarget,
} from "@/features/physical-labels/assetTargets";
import type { HydratedActor } from "@/server/hydrateActor";
import type { AssetSite } from "../contracts";
import { assetActor, assetSites, lockAssetRegister } from "../service";
import type {
  AssetTagAssignment,
  AssetTagTarget,
  AssetTagTargetRef,
  AssetTagWorkspace,
} from "./contracts";
import {
  assetTagAssignments,
  assetTagBatches,
  assetTagBindingEvents,
  assetTagCodes,
  assetTagOwnerMessages,
  assetTagScans,
} from "./schema";

export const unavailable = { ok: false, error: "unavailable" } as const;
export const invalid = { ok: false, error: "invalid" } as const;

export class TagFailure extends Error {
  constructor(readonly code: "invalid" | "unavailable" | "conflict" | "state") {
    super(code);
  }
}

export function fail(code: TagFailure["code"]): never {
  throw new TagFailure(code);
}

export async function lockTagNamespace(tx: Db, mode: "read" | "write") {
  await tx.execute(
    mode === "write"
      ? sql`SELECT pg_advisory_xact_lock(hashtext('warpdrive-equipment-tags'), hashtext('namespace-v1'))`
      : sql`SELECT pg_advisory_xact_lock_shared(hashtext('warpdrive-equipment-tags'), hashtext('namespace-v1'))`,
  );
}

export async function lockTagResources(tx: Db, mode: "read" | "write", signal: AbortSignal) {
  await lockDirectory(tx, "read", signal);
  await lockAssetRegister(tx, "read", signal);
  await lockTagNamespace(tx, mode);
  signal.throwIfAborted();
}

export async function withTagActor<T>(
  db: Db,
  who: NativeSessionRef,
  mode: "read" | "write",
  signal: AbortSignal,
  action: (tx: Db, actor: HydratedActor, sites: AssetSite[]) => Promise<T>,
): Promise<T | typeof unavailable> {
  try {
    return await withCurrentAuthority(db, "read", signal, async (tx) => {
      const actor = await assetActor(tx, who, signal);
      if (actor === null) return unavailable;
      await lockTagResources(tx, mode, signal);
      const sites = await assetSites(tx, actor);
      const result = await action(tx, actor, sites);
      if ((await assetActor(tx, who, signal)) === null) fail("unavailable");
      return result;
    });
  } catch (error) {
    if (error instanceof TagFailure && error.code === "unavailable") return unavailable;
    throw error;
  }
}

export function targetDto({
  kind,
  id,
  siteId,
  title,
  subtitle,
  href,
  canManage,
}: SiteAssetTarget): AssetTagTarget {
  return {
    kind,
    id,
    siteId,
    title,
    subtitle,
    href: kind === "kit" ? `/assets?kitId=${id}` : href,
    canManage,
  };
}

export async function activeTarget(tx: Db, sites: AssetSite[], ref: AssetTagTargetRef) {
  const [target] = await readSiteAssetTargets(tx, sites, [ref]);
  if (target === undefined || target.archived) return null;
  const [site] = await tx
    .select({ id: directorySites.id })
    .from(directorySites)
    .where(and(eq(directorySites.id, target.siteId), eq(directorySites.archived, false)));
  return site === undefined ? null : targetDto(target);
}

export type TagCode = typeof assetTagCodes.$inferSelect;
export type TagAssignment = typeof assetTagAssignments.$inferSelect;

export function targetRef(row: TagAssignment): AssetTagTargetRef {
  return { kind: row.targetKind, id: row.targetId };
}

const targetKey = (siteId: string, ref: AssetTagTargetRef) => `${siteId}:${ref.kind}:${ref.id}`;

function assignmentAccessColumns(
  columns: {
    siteId: typeof assetTagBindingEvents.siteId | typeof assetTagScans.siteId;
    assignmentId: typeof assetTagBindingEvents.assignmentId | typeof assetTagScans.assignmentId;
  },
  managerIds: string[],
  visibleAssignmentIds: string[],
) {
  return or(
    inArray(columns.siteId, managerIds),
    inArray(columns.assignmentId, visibleAssignmentIds),
  );
}

function projectAssignment(
  assignment: TagAssignment | null,
  target: SiteAssetTarget | undefined,
  managed: boolean,
): AssetTagAssignment | null {
  if (assignment === null || target === undefined || (!managed && target.archived)) {
    return null;
  }
  return {
    id: assignment.id,
    target: targetDto(target),
    assignedAt: assignment.assignedAt.toISOString(),
    ownerContact: assignment.ownerContact,
  };
}

async function projectTagCodes(tx: Db, sites: AssetSite[], targets: SiteAssetTarget[]) {
  const managerIds = sites.filter(({ canManage }) => canManage).map(({ id }) => id);
  const managesSite = new Set(managerIds);
  const lookup = new Map(targets.map((target) => [targetKey(target.siteId, target), target]));
  const rows = await tx
    .select({ code: assetTagCodes, assignment: assetTagAssignments })
    .from(assetTagCodes)
    .leftJoin(
      assetTagAssignments,
      and(eq(assetTagCodes.id, assetTagAssignments.tagId), isNull(assetTagAssignments.endedAt)),
    )
    .where(
      and(
        inArray(
          assetTagCodes.siteId,
          sites.map(({ id }) => id),
        ),
        or(inArray(assetTagCodes.siteId, managerIds), sql`${assetTagAssignments.id} IS NOT NULL`),
      ),
    )
    .orderBy(desc(assetTagCodes.batchId), assetTagCodes.ordinal);

  const tags: AssetTagWorkspace["tags"] = [];
  const viewerAssignmentIds: string[] = [];
  for (const { code, assignment } of rows) {
    const managed = managesSite.has(code.siteId);
    const target =
      assignment === null ? undefined : lookup.get(targetKey(code.siteId, targetRef(assignment)));
    const visibleAssignment = projectAssignment(assignment, target, managed);
    if (!managed && visibleAssignment === null) continue;
    if (!managed && visibleAssignment !== null) viewerAssignmentIds.push(visibleAssignment.id);
    tags.push({
      id: code.id,
      siteId: code.siteId,
      batchId: code.batchId,
      ordinal: code.ordinal,
      token: code.token,
      legacy: code.legacyId === null ? null : { id: code.legacyId, origin: code.legacyOrigin },
      assignment: visibleAssignment,
    });
  }
  return { tags, managerIds, viewerAssignmentIds };
}

export async function readTagWorkspace(tx: Db, sites: AssetSite[]): Promise<AssetTagWorkspace> {
  // The caller holds the tag and equipment fences while collecting this snapshot.
  const clock = await tx.execute<{ microseconds: string }>(
    sql`SELECT (extract(epoch FROM clock_timestamp()) * 1000000)::bigint::text AS microseconds`,
  );
  const readAt = Number(clock.rows[0]?.microseconds);
  if (!Number.isSafeInteger(readAt)) {
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Invalid equipment tag snapshot timestamp");
  }

  const allTargets = await readSiteAssetTargets(tx, sites);
  const targets = allTargets.filter((target) => !target.archived).map(targetDto);
  const { tags, managerIds, viewerAssignmentIds } = await projectTagCodes(tx, sites, allTargets);

  const batches = await tx
    .select()
    .from(assetTagBatches)
    .where(
      or(
        inArray(assetTagBatches.siteId, managerIds),
        inArray(assetTagBatches.id, [...new Set(tags.map(({ batchId }) => batchId))]),
      ),
    )
    .orderBy(desc(assetTagBatches.createdAt), desc(assetTagBatches.id));
  const events = await tx
    .select({
      id: assetTagBindingEvents.id,
      tagId: assetTagBindingEvents.tagId,
      assignmentId: assetTagBindingEvents.assignmentId,
      at: assetTagBindingEvents.at,
      kind: assetTagBindingEvents.kind,
      target: { id: assetTagAssignments.targetId, kind: assetTagAssignments.targetKind },
    })
    .from(assetTagBindingEvents)
    .innerJoin(assetTagAssignments, eq(assetTagAssignments.id, assetTagBindingEvents.assignmentId))
    .where(assignmentAccessColumns(assetTagBindingEvents, managerIds, viewerAssignmentIds))
    .orderBy(desc(assetTagBindingEvents.at), desc(assetTagBindingEvents.id));
  const scans = await tx
    .select()
    .from(assetTagScans)
    .where(assignmentAccessColumns(assetTagScans, managerIds, viewerAssignmentIds))
    .orderBy(desc(assetTagScans.at), desc(assetTagScans.id));
  const messages = await tx
    .select()
    .from(assetTagOwnerMessages)
    .where(inArray(assetTagOwnerMessages.siteId, managerIds))
    .orderBy(desc(assetTagOwnerMessages.at), desc(assetTagOwnerMessages.id));
  return {
    readAt,
    sites,
    targets,
    tags,
    batches: batches.map(({ id, siteId, title, source, createdAt }) => ({
      id,
      siteId,
      title,
      source,
      createdAt: createdAt.toISOString(),
    })),
    events: events.map((event) => ({ ...event, at: event.at.toISOString() })),
    scans: scans.map(
      ({ id, siteId, tagId, assignmentId, at, source, latitude, longitude, accuracy }) => ({
        id,
        tagId,
        assignmentId,
        at: at.toISOString(),
        source,
        coordinates:
          managerIds.includes(siteId) &&
          latitude !== null &&
          longitude !== null &&
          accuracy !== null
            ? { latitude, longitude, accuracy }
            : null,
      }),
    ),
    messages: messages.map(({ id, tagId, assignmentId, at, replyTo, message, readAt }) => ({
      id,
      tagId,
      assignmentId,
      at: at.toISOString(),
      replyTo,
      message,
      readAt: readAt?.toISOString() ?? null,
    })),
  };
}
