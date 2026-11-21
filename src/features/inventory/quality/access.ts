import { asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { directorySites } from "@/features/locations/schema";
import { lockDirectory } from "@/features/locations/service";
import {
  currentOperationsActor,
  readOperationsSiteGrants,
} from "@/features/operations-access/scope";
import type { HydratedActor } from "@/server/hydrateActor";
import { lockInventoryCatalog } from "../catalog/policy";
import { inventoryProductionBuilds } from "../production/buildSchema";
import { failQuality } from "./failure";
import { inventoryQualityPlanVersions, type QualityPlanRow } from "./planSchema";
import { inventoryQualityTargets, type QualityTargetRow } from "./schema";

export async function requireQualityActor(tx: Db, who: NativeSessionRef, signal: AbortSignal) {
  const actor = await currentOperationsActor(tx, who, signal);
  if (actor === null || actor.projectsGuestOnly) failQuality("unavailable");
  return actor;
}

export async function listQualitySites(tx: Db, actor: HydratedActor) {
  const isAdmin = actor.type === "admin";
  const siteIds = isAdmin
    ? []
    : (await readOperationsSiteGrants(tx, actor.id))
        .filter(({ role }) => role === "quality_operator")
        .map(({ siteId }) => siteId);
  return tx
    .select({
      id: directorySites.id,
      code: directorySites.code,
      name: directorySites.name,
      archived: directorySites.archived,
    })
    .from(directorySites)
    .where(isAdmin ? undefined : inArray(directorySites.id, siteIds))
    .orderBy(asc(directorySites.code), asc(directorySites.id));
}

export async function withQualityTarget<T>(
  db: Db,
  who: NativeSessionRef,
  targetId: string,
  mode: "read" | "record",
  signal: AbortSignal,
  run: (tx: Db, actor: HydratedActor, target: QualityTargetRow, plan: QualityPlanRow) => Promise<T>,
): Promise<T> {
  return withCurrentAuthority(db, "read", signal, async (tx) => {
    await lockInventoryCatalog(tx, signal);
    await lockDirectory(tx, "read", signal);
    const actor = await requireQualityActor(tx, who, signal);
    const [identity] = await tx
      .select({ siteId: inventoryQualityTargets.siteId, buildId: inventoryQualityTargets.buildId })
      .from(inventoryQualityTargets)
      .where(eq(inventoryQualityTargets.id, targetId));
    const site =
      identity === undefined
        ? undefined
        : (await listQualitySites(tx, actor)).find(({ id }) => id === identity.siteId);
    if (identity === undefined || site === undefined || (mode === "record" && site.archived))
      failQuality("unavailable");

    if (mode === "record") {
      // Use the same build-before-stock order as production and subcontract execution.
      await tx
        .select({ id: inventoryProductionBuilds.id })
        .from(inventoryProductionBuilds)
        .where(eq(inventoryProductionBuilds.id, identity.buildId))
        .for("update");
    }
    const targetQuery = tx
      .select()
      .from(inventoryQualityTargets)
      .where(eq(inventoryQualityTargets.id, targetId));
    const [target] = await (mode === "record" ? targetQuery.for("update") : targetQuery);
    if (target === undefined) failQuality("unavailable");
    const [plan] = await tx
      .select()
      .from(inventoryQualityPlanVersions)
      .where(eq(inventoryQualityPlanVersions.id, target.planVersionId));
    if (plan === undefined) failQuality("state");
    const value = await run(tx, actor, target, plan);
    await requireQualityActor(tx, who, signal);
    return value;
  });
}
