import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { users } from "@/db/schema/identity";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import { currentNativeActor, type NativeSessionRef } from "@/features/auth/currentNativeActor";
import { directorySites } from "@/features/locations/schema";
import type { OperationsGrant } from "./contracts";
import { operationsSiteGrants } from "./schema";

/** Use inside the same authority-fenced transaction as a scoped read or write. */
export function readOperationsSiteGrants(tx: Db, userId: string): Promise<OperationsGrant[]> {
  return tx
    .select()
    .from(operationsSiteGrants)
    .where(eq(operationsSiteGrants.userId, userId))
    .orderBy(asc(operationsSiteGrants.siteId), asc(operationsSiteGrants.role));
}

export function operationsSiteCapabilities(
  grants: readonly OperationsGrant[],
  isAdmin: boolean,
  siteId: string,
) {
  const roles = new Set(grants.filter((grant) => grant.siteId === siteId).map(({ role }) => role));
  const canManageWarehouse = isAdmin || roles.has("warehouse_manager");
  const canManageAssets = isAdmin || roles.has("asset_manager");
  return {
    canReadWarehouse: canManageWarehouse || roles.has("warehouse_viewer"),
    canManageWarehouse,
    canReadAssets: canManageAssets || roles.has("asset_viewer"),
    canManageAssets,
    canBuy: isAdmin || roles.has("buyer"),
    canViewCosts: isAdmin || roles.has("cost_viewer"),
    canInspectQuality: isAdmin || roles.has("quality_operator"),
  };
}

export async function currentOperationsActor(tx: Db, who: NativeSessionRef, signal: AbortSignal) {
  const current = await currentNativeActor(tx, who, signal);
  if (current === null) return null;
  const [staff] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, current.actor.id), isNull(users.invitedAt)));
  signal.throwIfAborted();
  return staff === undefined ? null : current.actor;
}

const unavailable = { ok: false, error: "unavailable" } as const;

export function readOperationsScope(db: Db, who: NativeSessionRef, signal: AbortSignal) {
  return withCurrentAuthority(db, "read", signal, async (tx) => {
    const actor = await currentOperationsActor(tx, who, signal);
    if (actor === null) return unavailable;
    const isAdmin = actor.type === "admin";
    const grants = isAdmin ? [] : await readOperationsSiteGrants(tx, actor.id);
    const sites = await tx
      .select({ siteId: directorySites.id })
      .from(directorySites)
      .where(
        isAdmin
          ? undefined
          : inArray(
              directorySites.id,
              grants.map(({ siteId }) => siteId),
            ),
      )
      .orderBy(asc(directorySites.code));
    const scoped = sites.map(({ siteId }) => ({
      siteId,
      ...operationsSiteCapabilities(grants, isAdmin, siteId),
    }));
    if ((await currentOperationsActor(tx, who, signal)) === null) return unavailable;
    return { ok: true, value: { sites: scoped } } as const;
  });
}
