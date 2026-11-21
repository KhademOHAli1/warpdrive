import { and, asc, desc, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
import type { Db } from "@/db/client";
import { directoryLocations } from "@/features/locations/schema";
import { lockInternalProject } from "@/features/projects/access";
import type { HydratedActor } from "@/server/hydrateActor";
import type { BomPart, BomRelease } from "../bom/contracts";
import { type BomGraph, readBomGraph } from "../bom/graph";
import { readBomNodes, readBomReleaseDirectory } from "../bom/reads";
import { inventoryPartProfiles } from "../catalog/schema";
import { inventoryProjectsEnabled } from "../projectBridge";
import { inventoryItems, inventoryTemplates } from "../schema";
import type { WarehouseAccess } from "../warehouse/access";
import { inventoryStockEventDetails } from "../warehouse/operations/schema";
import { inventoryStockPositions } from "../warehouse/schema";
import {
  availableProductionPositions,
  readBuildAllocations,
  readBuildMaterials,
} from "./allocations";
import {
  inventoryProductionBuilds,
  inventoryProductionOutputs,
  type ProductionBuildRow,
} from "./buildSchema";
import type {
  ProductionBuild,
  ProductionDetail,
  ProductionPosition,
  ProductionQuery,
  ProductionWorkspace,
} from "./contracts";
import { failProduction } from "./failure";
import { inventoryProductionInputs, inventoryProductionReceipts } from "./materialSchema";
import { readProductionProject } from "./projects";

type EngineeringScope = readonly string[] | null;
const builds = inventoryProductionBuilds;

function readBuildRows(tx: Db, access: WarehouseAccess, scope: EngineeringScope, condition?: SQL) {
  return tx
    .select({ build: builds })
    .from(builds)
    .innerJoin(inventoryItems, eq(inventoryItems.id, builds.itemId))
    .leftJoin(inventoryPartProfiles, eq(inventoryPartProfiles.itemId, builds.itemId))
    .where(
      and(
        inArray(
          builds.siteId,
          access.sites.map(({ id }) => id),
        ),
        scope === null ? undefined : inArray(builds.itemId, scope),
        scope === null
          ? undefined
          : or(eq(inventoryPartProfiles.visibility, "staff"), isNull(inventoryPartProfiles.itemId)),
        condition,
      ),
    )
    .orderBy(desc(builds.createdAt), desc(builds.id));
}

function header(
  build: ProductionBuildRow,
  release: BomRelease,
  access: WarehouseAccess,
  visible: ReadonlySet<string>,
): ProductionBuild {
  const site = access.sites.find(({ id }) => id === build.siteId);
  const location = access.locations.find(({ id }) => id === build.locationId);
  if (site === undefined || location === undefined) failProduction("unavailable");
  return {
    id: build.id,
    release,
    parentId: build.parentId !== null && visible.has(build.parentId) ? build.parentId : null,
    siteId: site.id,
    site: site.name,
    location: location.name,
    quantity: build.quantity,
    completed: build.completed,
    scrapped: build.scrapped,
    status: build.status,
    priority: build.priority,
    dueDate: build.dueDate,
    createdAt: build.createdAt.toISOString(),
    trackable: build.trackable,
    version: build.version,
    canManage:
      site.canManage && !site.archived && !location.archived && location.kind === "storage",
  };
}

async function buildHeaders(
  tx: Db,
  rows: ProductionBuildRow[],
  access: WarehouseAccess,
  scope: EngineeringScope,
) {
  if (rows.length === 0) return [];
  const versions = await readBomNodes(tx, scope, [
    ...new Set(rows.map(({ releaseId }) => releaseId)),
  ]);
  const byId = new Map(versions.map(({ release }) => [release.id, release]));
  const visible = new Set(rows.map(({ id }) => id));
  return rows.map((row) => {
    const release = byId.get(row.releaseId);
    if (release === undefined) failProduction("unavailable");
    return header(row, release, access, visible);
  });
}

type Position = typeof inventoryStockPositions.$inferSelect;

function positionView(
  position: Position,
  binLabel: string,
  sourceBuilds: ReadonlyMap<string, string>,
  exposeFree = true,
): ProductionPosition {
  const source =
    position.buildOutputId === null ? undefined : sourceBuilds.get(position.buildOutputId);
  return {
    id: position.id,
    location: binLabel,
    lot: position.lot,
    serial: position.serial,
    free: exposeFree ? Math.max(position.onHand - position.reserved, 0) : 0,
    buildOutputId: position.buildOutputId,
    ...(source === undefined ? {} : { sourceBuildId: source }),
  };
}

async function originLinks(
  tx: Db,
  access: WarehouseAccess,
  graph: BomGraph,
  positions: Position[],
) {
  const ids = [
    ...new Set(
      positions.flatMap(({ buildOutputId }) => (buildOutputId === null ? [] : [buildOutputId])),
    ),
  ];
  if (ids.length === 0) return new Map<string, string>();
  const rows = await tx
    .select({ id: inventoryProductionOutputs.id, buildId: builds.id })
    .from(inventoryProductionOutputs)
    .innerJoin(builds, eq(builds.id, inventoryProductionOutputs.buildId))
    .where(
      and(
        inArray(inventoryProductionOutputs.id, ids),
        inArray(
          builds.siteId,
          access.sites.map(({ id }) => id),
        ),
        inArray(
          builds.releaseId,
          graph.ordered.map(({ release }) => release.id),
        ),
      ),
    );
  return new Map(rows.map(({ id, buildId }) => [id, buildId]));
}

function partForBuild(graph: BomGraph, id: string): BomPart {
  const match = graph.parts.get(id);
  if (match === undefined) failProduction("unavailable");
  return match.part;
}

async function materialAndOutputs(
  tx: Db,
  build: ProductionBuildRow,
  graph: BomGraph,
  access: WarehouseAccess,
): Promise<Pick<ProductionDetail, "materials" | "outputs">> {
  const materials = await readBuildMaterials(tx, build.id);
  const allocations = await readBuildAllocations(tx, build.id);
  const outputs = await tx
    .select()
    .from(inventoryProductionOutputs)
    .where(eq(inventoryProductionOutputs.buildId, build.id))
    .orderBy(desc(inventoryProductionOutputs.createdAt), desc(inventoryProductionOutputs.id))
    .limit(500);
  const inputRows = await tx
    .select({
      input: inventoryProductionInputs,
      position: inventoryStockPositions,
      location: directoryLocations.name,
    })
    .from(inventoryProductionInputs)
    .innerJoin(
      inventoryProductionOutputs,
      eq(inventoryProductionOutputs.id, inventoryProductionInputs.outputId),
    )
    .innerJoin(
      inventoryStockPositions,
      eq(inventoryStockPositions.id, inventoryProductionInputs.positionId),
    )
    .leftJoin(
      inventoryStockEventDetails,
      eq(inventoryStockEventDetails.eventId, inventoryProductionInputs.eventId),
    )
    .leftJoin(directoryLocations, eq(directoryLocations.id, inventoryStockEventDetails.locationId))
    .where(
      and(
        eq(inventoryProductionOutputs.buildId, build.id),
        inArray(
          inventoryProductionInputs.outputId,
          outputs.map(({ id }) => id),
        ),
      ),
    );
  const candidates = new Map<string, Position[]>();
  for (const material of materials) {
    candidates.set(
      material.id,
      (await availableProductionPositions(tx, build.siteId, material)).slice(0, 120),
    );
  }
  const origins = await originLinks(tx, access, graph, [
    ...allocations.map(({ position }) => position),
    ...inputRows.map(({ position }) => position),
    ...[...candidates.values()].flat(),
  ]);
  const locationNames = new Map(access.locations.map(({ id, name }) => [id, name]));
  const activeBuildUnits = build.completed + build.scrapped;
  return {
    materials: materials.map((material) => {
      const selected = allocations.filter(
        ({ allocation }) => allocation.materialId === material.id,
      );
      return {
        id: material.id,
        part: { ...partForBuild(graph, material.itemId), unit: material.stockUnit },
        releaseId: material.requiredReleaseId,
        perUnit: material.perUnit,
        demand: material.perUnit * build.quantity,
        allocated: selected.reduce((sum, { allocation }) => sum + allocation.quantity, 0),
        consumed: material.consumable ? 0 : material.perUnit * activeBuildUnits,
        consumable: material.consumable,
        positions: (candidates.get(material.id) ?? []).map((position) =>
          positionView(position, locationNames.get(position.locationId) ?? "", origins),
        ),
        allocations: selected.map(({ allocation, position }) => ({
          quantity: allocation.quantity,
          position: positionView(position, locationNames.get(position.locationId) ?? "", origins),
        })),
      };
    }),
    outputs: outputs.map((output) => ({
      id: output.id,
      quantity: output.quantity,
      status: output.status,
      lot: output.lot,
      serials: output.serials,
      reason: output.reason,
      createdAt: output.createdAt.toISOString(),
      inputs: inputRows
        .filter(({ input }) => input.outputId === output.id)
        .map(({ input, position, location }) => ({
          part: partForBuild(graph, input.itemId),
          position: positionView(position, location ?? "", origins, false),
          quantity: input.quantity,
          eventId: input.eventId,
        })),
    })),
  };
}

async function readDetail(
  tx: Db,
  actor: HydratedActor,
  access: WarehouseAccess,
  scope: EngineeringScope,
  buildId: string,
  signal: AbortSignal,
) {
  const [selected] = await readBuildRows(tx, access, scope, eq(builds.id, buildId)).limit(1);
  if (selected === undefined) failProduction("unavailable");
  const { build } = selected;
  const graph = await readBomGraph(tx, scope, build.releaseId, signal);
  const related = await readBuildRows(
    tx,
    access,
    scope,
    or(
      eq(builds.parentId, build.id),
      build.parentId === null ? undefined : eq(builds.id, build.parentId),
    ),
  ).limit(120);
  const family = await buildHeaders(tx, [build, ...related.map((row) => row.build)], access, scope);
  const current = family.find(({ id }) => id === build.id);
  if (current === undefined) failProduction("unavailable");
  const audit = await tx
    .select({
      id: inventoryProductionReceipts.requestId,
      type: inventoryProductionReceipts.command,
      reason: inventoryProductionReceipts.reason,
      at: inventoryProductionReceipts.createdAt,
    })
    .from(inventoryProductionReceipts)
    .where(eq(inventoryProductionReceipts.buildId, build.id))
    .orderBy(desc(inventoryProductionReceipts.createdAt))
    .limit(100);
  return {
    ...current,
    ...(await materialAndOutputs(tx, build, graph, access)),
    children: family.filter(({ parentId }) => parentId === build.id),
    history: audit.map((entry) => ({ ...entry, at: entry.at.toISOString() })),
    project: await readProductionProject(tx, actor, build, signal),
  };
}

async function permittedTemplates(
  tx: Db,
  actor: HydratedActor,
  releaseOptions: BomRelease[],
  signal: AbortSignal,
) {
  const result = new Set<string>();
  if (releaseOptions.length === 0 || !(await inventoryProjectsEnabled(tx))) return result;
  const rows = await tx
    .select({ projectId: inventoryTemplates.projectId, itemId: inventoryTemplates.itemId })
    .from(inventoryTemplates)
    .where(
      inArray(
        inventoryTemplates.itemId,
        releaseOptions.map(({ part }) => part.id),
      ),
    )
    .orderBy(asc(inventoryTemplates.projectId));
  for (const { projectId, itemId } of rows) {
    signal.throwIfAborted();
    const project = await lockInternalProject(tx, actor, projectId, "read", "work-items");
    if (
      project.ok &&
      project.value.canAssign &&
      !project.value.summary.archived &&
      project.value.guestAccess === null
    )
      result.add(itemId);
  }
  return result;
}

export async function projectProductionWorkspace(
  tx: Db,
  actor: HydratedActor,
  access: WarehouseAccess,
  scope: EngineeringScope,
  query: ProductionQuery,
  signal: AbortSignal,
): Promise<ProductionWorkspace> {
  if (query.siteId !== undefined && !access.sites.some(({ id }) => id === query.siteId))
    failProduction("unavailable");
  const bucket = await readBuildRows(
    tx,
    access,
    scope,
    query.siteId === undefined ? undefined : eq(builds.siteId, query.siteId),
  ).limit(160);
  const preferred =
    query.releaseId === undefined
      ? undefined
      : (await readBomNodes(tx, scope, [query.releaseId]))[0];
  const releases = await readBomReleaseDirectory(tx, scope, preferred?.release ?? null);
  const templates = await permittedTemplates(tx, actor, releases, signal);
  return {
    builds: await buildHeaders(
      tx,
      bucket.map(({ build }) => build),
      access,
      scope,
    ),
    detail:
      query.buildId === undefined
        ? null
        : await readDetail(tx, actor, access, scope, query.buildId, signal),
    releases: releases.map((release) => ({
      ...release,
      templateAvailable: templates.has(release.part.id),
    })),
    sites: access.sites.map((site) => ({
      id: site.id,
      code: site.code,
      name: site.name,
      canManage: site.canManage && !site.archived,
      locations: access.locations
        .filter(
          (location) =>
            location.siteId === site.id && !location.archived && location.kind === "storage",
        )
        .map(({ id, code, name }) => ({ id, code, name })),
    })),
  };
}
