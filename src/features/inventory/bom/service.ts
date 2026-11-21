import type { Db } from "@/db/client";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { lockDirectory } from "@/features/locations/service";
import type { HydratedActor } from "@/server/hydrateActor";
import { err, ok } from "@/types/result";
import { currentInventoryActor } from "../access";
import { lockInventoryCatalog } from "../catalog/policy";
import {
  type BomPlanningQuery,
  type BomPlanningResult,
  type BomPlanningWorkspace,
  bomPlanningQuery,
} from "./contracts";
import { BomPlanningFailure, failBom } from "./failure";
import { type BomGraph, readBomGraph } from "./graph";
import { compareBoms, planBom } from "./planning";
import {
  lockBomReleaseGrants,
  readBomAvailability,
  readBomParts,
  readBomReleaseDirectory,
  readBomSites,
  readBomWhereUsed,
  readLatestBomRelease,
} from "./reads";

type Scope = Awaited<ReturnType<typeof lockBomReleaseGrants>>;

async function chooseGraph(tx: Db, scope: Scope, query: BomPlanningQuery, signal: AbortSignal) {
  if (query.releaseId !== undefined) return readBomGraph(tx, scope, query.releaseId, signal);
  if (query.partId === undefined) return null;
  const latest = await readLatestBomRelease(tx, scope, query.partId);
  if (latest === null) return null;
  try {
    return await readBomGraph(tx, scope, latest.id, signal);
  } catch (error) {
    // The catalog's where-used view can still work when the latest root package
    // depends on a child release the requester cannot see.
    if (error instanceof BomPlanningFailure && error.code === "unavailable") return null;
    throw error;
  }
}

async function chooseComparison(
  tx: Db,
  scope: Scope,
  root: BomGraph | null,
  compareId: string | undefined,
  signal: AbortSignal,
) {
  if (compareId === undefined) return null;
  if (root === null || root.root.release.id === compareId) failBom("invalid");
  const earlier = await readBomGraph(tx, scope, compareId, signal);
  if (earlier.root.release.part.code !== root.root.release.part.code) failBom("invalid");
  return compareBoms(earlier, root);
}

async function materialPlan(
  tx: Db,
  graph: BomGraph | null,
  siteId: string | null,
  query: BomPlanningQuery,
) {
  const choices = query.choices ?? [];
  if (graph === null) {
    if (choices.length > 0) failBom("invalid");
    return null;
  }
  const availability = await readBomAvailability(tx, siteId, graph.parts);
  return planBom(graph, query.quantity ?? 1, choices, availability);
}

async function readUsagePart(tx: Db, scope: Scope, partId: string | undefined) {
  if (partId === undefined) return null;
  const match = (await readBomParts(tx, scope, [partId])).get(partId);
  if (match === undefined) failBom("unavailable");
  return match.part;
}

async function projectWorkspace(
  tx: Db,
  actor: HydratedActor,
  query: BomPlanningQuery,
  signal: AbortSignal,
): Promise<BomPlanningWorkspace> {
  const scope = await lockBomReleaseGrants(tx, actor);
  const sites = await readBomSites(tx, actor);
  const siteId = query.siteId ?? null;
  if (siteId !== null && !sites.some(({ id }) => id === siteId)) failBom("unavailable");

  const graph = await chooseGraph(tx, scope, query, signal);
  const chosen = graph?.root.release ?? null;
  const whereUsedPart = await readUsagePart(tx, scope, query.partId ?? chosen?.part.id);
  const whereUsed =
    whereUsedPart === null ? [] : await readBomWhereUsed(tx, scope, whereUsedPart.id);
  return {
    releases: await readBomReleaseDirectory(tx, scope, chosen),
    sites,
    siteId,
    plan: await materialPlan(tx, graph, siteId, query),
    whereUsedPart,
    whereUsed,
    comparison: await chooseComparison(tx, scope, graph, query.compareReleaseId, signal),
  };
}

export async function readBomPlanningWorkspace(
  db: Db,
  who: NativeSessionRef,
  input: BomPlanningQuery,
  signal: AbortSignal,
): Promise<BomPlanningResult> {
  const query = bomPlanningQuery.safeParse(input);
  if (!query.success) return err("invalid");
  try {
    return await withCurrentAuthority(db, "read", signal, async (tx) => {
      await lockInventoryCatalog(tx, signal);
      await lockDirectory(tx, "read", signal);
      const actor = await currentInventoryActor(tx, who, signal);
      if (actor === null || actor.projectsGuestOnly) failBom("unavailable");
      const value = await projectWorkspace(tx, actor, query.data, signal);
      if ((await currentInventoryActor(tx, who, signal)) === null) failBom("unavailable");
      return ok(value);
    });
  } catch (error) {
    if (error instanceof BomPlanningFailure) return err(error.code);
    throw error;
  }
}
