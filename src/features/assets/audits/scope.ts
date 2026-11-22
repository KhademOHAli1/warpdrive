import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { lockDirectory } from "@/features/locations/service";
import type { HydratedActor } from "@/server/hydrateActor";
import { bookingSites } from "../bookings/scope";
import type { AssetSite } from "../contracts";
import { assetActor, assetSites, lockAssetRegister } from "../service";
import { assetAuditAssignments } from "./schema";
import type { AuditActor, AuditParticipant, AuditRole } from "./state";

export const auditUnavailable = { ok: false, error: "unavailable" } as const;
export const auditInvalid = { ok: false, error: "invalid" } as const;
class AuditSessionExpired extends Error {}

export async function withAuditAuthority<T>(
  db: Db,
  who: NativeSessionRef,
  signal: AbortSignal,
  run: (tx: Db, actor: HydratedActor) => Promise<T>,
): Promise<T | typeof auditUnavailable> {
  try {
    return await withCurrentAuthority(db, "read", signal, async (tx) => {
      await lockDirectory(tx, "read", signal);
      const actor = await assetActor(tx, who, signal);
      if (actor === null) return auditUnavailable;
      await lockAssetRegister(tx, "read", signal);
      const result = await run(tx, actor);
      if ((await assetActor(tx, who, signal)) === null) throw new AuditSessionExpired();
      return result;
    });
  } catch (error) {
    if (error instanceof AuditSessionExpired) return auditUnavailable;
    throw error;
  }
}

export async function readAuditAuthority(tx: Db, actor: HydratedActor) {
  const bookings = await bookingSites(tx, actor);
  const managed = new Set(
    (await assetSites(tx, actor)).filter(({ canManage }) => canManage).map(({ id }) => id),
  );
  const roles: Record<string, AuditRole> = {};
  const participants: Record<string, readonly AuditParticipant[]> = {};
  const sites: AssetSite[] = [];
  const managerSiteIds: string[] = [];
  const assignedSiteIds: string[] = [];
  const principal = { id: actor.id, name: actor.name };

  for (const site of bookings) {
    if (site.archived === true) continue;
    const { id: siteId, code, name, role } = site;
    const canManage = managed.has(siteId);
    if (canManage) {
      roles[siteId] = "manager";
      participants[siteId] = site.participants.some(({ id }) => id === principal.id)
        ? site.participants
        : [...site.participants, principal];
      managerSiteIds.push(siteId);
    } else if (role === "base" || role === "self_service") {
      roles[siteId] = role;
      participants[siteId] = [principal];
      assignedSiteIds.push(siteId);
    } else {
      continue;
    }
    sites.push({ id: siteId, code, name, canManage });
  }

  const viewer: AuditActor = { ...principal, roles, active: true };
  return {
    viewer,
    sites,
    participants,
    recordScope: { actorId: actor.id, managerSiteIds, assignedSiteIds },
  };
}

export type AuditAuthority = Awaited<ReturnType<typeof readAuditAuthority>>;

async function hasAssignedAudit(tx: Db, actorId: string, siteIds: string[], auditId?: string) {
  if (siteIds.length === 0) return false;
  const [assignment] = await tx
    .select({ auditId: assetAuditAssignments.auditId })
    .from(assetAuditAssignments)
    .where(
      and(
        eq(assetAuditAssignments.userId, actorId),
        inArray(assetAuditAssignments.siteId, siteIds),
        auditId === undefined ? undefined : eq(assetAuditAssignments.auditId, auditId),
      ),
    )
    .limit(1);
  return assignment !== undefined;
}

export function hasEquipmentAuditScope(
  tx: Db,
  authority: AuditAuthority,
  siteId: string,
  auditId: string,
) {
  const role = authority.viewer.roles[siteId];
  if (role === "manager") return Promise.resolve(true);
  if (role !== "base" && role !== "self_service") return Promise.resolve(false);
  return hasAssignedAudit(tx, authority.viewer.id, [siteId], auditId);
}

export async function canBrowseEquipmentAudits(tx: Db, actor: HydratedActor): Promise<boolean> {
  if (!actor.isActive || actor.projectsGuestOnly === true) return false;
  if (actor.type === "admin") return true;
  const { recordScope } = await readAuditAuthority(tx, actor);
  if (recordScope.managerSiteIds.length > 0) return true;
  return hasAssignedAudit(tx, actor.id, recordScope.assignedSiteIds);
}
