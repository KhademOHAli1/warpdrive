import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { directorySites } from "@/features/locations/schema";
import type { HydratedActor } from "@/server/hydrateActor";
import { readBookingRoles } from "../../bookings/scope";
import { assetRecords } from "../../schema";
import { assetSites } from "../../service";
import { auditUnavailable, withAuditAuthority } from "../scope";
import {
  type AssetAuditHistoryEntry,
  type AssetAuditHistoryResult,
  assetAuditHistoryMaxEntries,
} from "./contracts";
import { assetAuditHistoryEntry } from "./projection";
import {
  assetAuditHistoryMaxFindings,
  auditFindingActivity,
  readScopedAssetAuditHistory,
} from "./repository";

const equipmentId = z.uuid().toLowerCase();

async function historyScope(tx: Db, actor: HydratedActor, assetId: string) {
  const sites = await assetSites(tx, actor);
  if (sites.length === 0) return null;
  const [asset] = await tx
    .select({ siteId: assetRecords.siteId })
    .from(assetRecords)
    .innerJoin(directorySites, eq(assetRecords.siteId, directorySites.id))
    .where(
      and(
        eq(assetRecords.id, assetId),
        inArray(
          assetRecords.siteId,
          sites.map(({ id }) => id),
        ),
        eq(directorySites.archived, false),
      ),
    );
  if (asset === undefined) return null;
  const { siteId } = asset;
  if (sites.some(({ id, canManage }) => id === siteId && canManage))
    return { siteId, assetId, assignedUserId: null };
  const role = (await readBookingRoles(tx, actor.id)).get(siteId);
  return role === "base" || role === "self_service"
    ? { siteId, assetId, assignedUserId: actor.id }
    : null;
}

export async function readAssetAuditHistory(
  db: Db,
  who: NativeSessionRef,
  rawAssetId: unknown,
  signal: AbortSignal,
): Promise<AssetAuditHistoryResult> {
  const parsed = equipmentId.safeParse(rawAssetId);
  if (!parsed.success) return auditUnavailable;
  const assetId = parsed.data;
  return withAuditAuthority(db, who, signal, async (tx, actor) => {
    const scope = await historyScope(tx, actor, assetId);
    if (scope === null) return auditUnavailable;
    const report = await readScopedAssetAuditHistory(tx, scope);
    signal.throwIfAborted();
    let truncated = report.length > assetAuditHistoryMaxEntries;
    const entries: AssetAuditHistoryEntry[] = [];
    for (const header of report.slice(0, assetAuditHistoryMaxEntries)) {
      const rows = header.findings.slice(0, assetAuditHistoryMaxFindings);
      const activity = rows.map(auditFindingActivity);
      truncated ||= header.findings.length > rows.length || activity.some((row) => row.truncated);
      const projected = assetAuditHistoryEntry(
        {
          id: header.id,
          title: header.title,
          status: "completed",
          archived: header.archived,
          completedAt: new Date(header.completedAt).toISOString(),
          rows,
          activity: activity.flatMap((row) => row.activity),
        },
        assetId,
      );
      if (projected !== null) entries.push(projected);
    }
    return truncated
      ? ({ ok: true, entries, truncated: true } as const)
      : ({ ok: true, entries } as const);
  });
}
