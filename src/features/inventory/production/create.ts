import { randomUUID } from "node:crypto";
import type { Db } from "@/db/client";
import type { HydratedActor } from "@/server/hydrateActor";
import type { BomEdge, BomRelease } from "../bom/contracts";
import type { BomGraph } from "../bom/graph";
import { maxBomEdges, maxBomReleases } from "../bom/limits";
import { planBom } from "../bom/planning";
import { canHoldInventory } from "../catalog/eligibility";
import { catalogItemPolicy } from "../catalog/policy";
import { inventoryStockLimit } from "../schema";
import { autoAllocateProductionMaterial } from "./allocations";
import { inventoryProductionBuilds, type ProductionBuildRow } from "./buildSchema";
import type { ProductionCommand } from "./contracts";
import { failProduction } from "./failure";
import { inventoryProductionMaterials, type ProductionMaterialRow } from "./materialSchema";
import { applyProductionTemplate, chooseProductionTemplate } from "./projects";

type CreateBuild = Extract<ProductionCommand, { type: "createBuild" }>;
type Demand = Pick<
  ProductionMaterialRow,
  "itemId" | "requiredReleaseId" | "consumable" | "perUnit" | "stockUnit"
>;

function boundedDemand(quantity: number) {
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > inventoryStockLimit)
    failProduction("limit");
  return quantity;
}

function mergeDemand(demands: Map<string, Demand>, line: Demand, multiplier = 1) {
  const key = `${line.itemId}:${line.requiredReleaseId ?? ""}:${line.consumable}`;
  const existing = demands.get(key);
  if (existing !== undefined && existing.stockUnit !== line.stockUnit)
    failProduction("unitChanged");
  const perUnit = boundedDemand((existing?.perUnit ?? 0) + line.perUnit * multiplier);
  demands.set(key, { ...line, perUnit });
}

function addEdgeDemand(
  demand: Map<string, Demand>,
  requirements: ReadonlyMap<string, Demand[]>,
  edge: BomEdge,
) {
  const chosen = [edge.primary, ...edge.alternatives].find(({ id }) => id === edge.chosenItemId);
  if (chosen === undefined) failProduction("invalid");
  if (edge.inherited && edge.childReleaseId !== null) {
    for (const line of requirements.get(edge.childReleaseId) ?? [])
      mergeDemand(demand, line, chosen.quantity);
    return;
  }
  mergeDemand(demand, {
    itemId: chosen.id,
    requiredReleaseId: edge.childReleaseId,
    perUnit: chosen.quantity,
    stockUnit: chosen.unit,
    consumable: edge.consumable,
  });
}

function directDemands(graph: BomGraph, edges: BomEdge[]) {
  const byNode = new Map<string, BomEdge[]>();
  for (const edge of edges) {
    if (!edge.included) continue;
    const group = byNode.get(edge.releaseId) ?? [];
    group.push(edge);
    byNode.set(edge.releaseId, group);
  }
  const requirements = new Map<string, Demand[]>();
  // Inherited lines unfold into the current build, with no phantom build or reservation.
  for (const { release } of [...graph.ordered].reverse()) {
    const demand = new Map<string, Demand>();
    for (const edge of byNode.get(release.id) ?? []) addEdgeDemand(demand, requirements, edge);
    if (demand.size > maxBomEdges) failProduction("limit");
    requirements.set(release.id, [...demand.values()]);
  }
  return requirements;
}

async function insertBuild(
  tx: Db,
  actorId: string,
  command: CreateBuild,
  release: BomRelease,
  quantity: number,
  parentId: string | null,
  template: Awaited<ReturnType<typeof chooseProductionTemplate>> | null,
): Promise<ProductionBuildRow> {
  const policy = await catalogItemPolicy(tx, release.part.id);
  if (!canHoldInventory(policy) || policy?.flags.assembly !== true) failProduction("state");
  const [build] = await tx
    .insert(inventoryProductionBuilds)
    .values({
      id: randomUUID(),
      itemId: release.part.id,
      releaseId: release.id,
      parentId,
      siteId: command.siteId,
      locationId: command.locationId,
      quantity,
      priority: command.priority,
      dueDate: command.dueDate,
      stockUnit: release.part.unit,
      trackable: policy.flags.trackable,
      projectId: template?.projectId ?? null,
      templateRevision: template?.revision ?? null,
      createdBy: actorId,
    })
    .returning();
  if (build === undefined) failProduction("state");
  return build;
}

async function materializeChildren(
  tx: Db,
  build: ProductionBuildRow,
  material: Demand[],
  context: {
    actorId: string;
    command: CreateBuild;
    releases: ReadonlyMap<string, BomRelease>;
    remainingBuilds: number;
  },
) {
  if (material.length === 0) return [];
  const { actorId, command, releases, remainingBuilds } = context;
  for (const line of material) boundedDemand(line.perUnit * build.quantity);
  const saved = await tx
    .insert(inventoryProductionMaterials)
    .values(material.map((line) => ({ ...line, buildId: build.id })))
    .returning();
  const children: ProductionBuildRow[] = [];
  for (const line of saved) {
    if (line.requiredReleaseId === null) continue;
    const child = releases.get(line.requiredReleaseId);
    if (child === undefined) failProduction("invalid");
    const required = line.perUnit * build.quantity;
    const allocated = await autoAllocateProductionMaterial(
      tx,
      actorId,
      command.requestId,
      build,
      line,
      required,
    );
    const shortfall = required - allocated;
    if (shortfall <= 0) continue;
    if (children.length >= remainingBuilds || shortfall > 1_000_000) failProduction("limit");
    children.push(await insertBuild(tx, actorId, command, child, shortfall, build.id, null));
  }
  return children;
}

export async function createProductionTree(
  tx: Db,
  actor: HydratedActor,
  command: CreateBuild,
  graph: BomGraph,
  signal: AbortSignal,
) {
  const plan = planBom(graph, command.quantity, command.choices, new Map());
  const demands = directDemands(graph, plan.edges);
  const releases = new Map(graph.ordered.map(({ release }) => [release.id, release]));
  const template = command.useTemplate
    ? await chooseProductionTemplate(tx, actor, plan.release.part.id, signal)
    : null;
  const root = await insertBuild(
    tx,
    actor.id,
    command,
    plan.release,
    command.quantity,
    null,
    template,
  );
  const queue = [root];
  let materialCount = 0;
  for (const build of queue) {
    signal.throwIfAborted();
    const material = demands.get(build.releaseId) ?? [];
    materialCount += material.length;
    if (materialCount > maxBomEdges) failProduction("limit");
    const children = await materializeChildren(tx, build, material, {
      actorId: actor.id,
      command,
      releases,
      remainingBuilds: maxBomReleases - queue.length,
    });
    queue.push(...children);
  }
  if (template !== null) await applyProductionTemplate(tx, actor.id, root, template, signal);
  return root.id;
}
