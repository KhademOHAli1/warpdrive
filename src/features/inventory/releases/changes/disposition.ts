import { and, asc, desc, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@/db/client";
import { users } from "@/db/schema/identity";
import { requireCurrentAuthority } from "@/features/auth/currentAuthority";
import { lockDirectory } from "@/features/locations/service";
import type { HydratedActor } from "@/server/hydrateActor";
import { catalogItemPolicy, lockInventoryCatalog } from "../../catalog/policy";
import { InventoryDomainError } from "../../errors";
import { inventoryProductionOutputs } from "../../production/buildSchema";
import { lockInventoryStock } from "../../stock";
import { readWarehouseAccess, type WarehouseAccess } from "../../warehouse/access";
import { movePositionState } from "../../warehouse/changes";
import { addOperationEvent, type Position } from "../../warehouse/operations/shared";
import {
  inventoryStockEventDetails,
  inventoryStockEvents,
  inventoryStockPositions,
} from "../../warehouse/schema";
import { requireItemReleaseAccess } from "../access";
import { lockReleaseArtifactItem } from "../artifacts";
import { inventoryProductReleases } from "../schema";
import type {
  EngineeringChangeCommand,
  EngineeringChangeWorkspace,
  OldReleasePosition,
} from "./contracts";
import { readDispositionCustodyBlocks } from "./dispositionGuards";
import { failEngineering as fail } from "./errors";
import { readEngineeringTime } from "./records";
import { inventoryEngineeringChanges, inventoryEngineeringHolds } from "./schema";

type Disposition = Extract<EngineeringChangeCommand, { type: "disposition" }>;
type Hold = typeof inventoryEngineeringHolds.$inferSelect;
type StockRow = {
  position: Position;
  version: string;
  outputReleaseId: string | null;
};
const stock = inventoryStockPositions;
const outputs = inventoryProductionOutputs;
const changes = inventoryEngineeringChanges;
const holds = inventoryEngineeringHolds;
const releases = inventoryProductReleases;
const events = inventoryStockEvents;
const details = inventoryStockEventDetails;

// The stateless version changes whenever an ordinary Warehouse action rewrites
// this physical position, including quantity, reservations, placement or state.
const positionVersion = sql<string>`"inventory_stock_positions"."xmin"::text`;

async function lockDispositionDirectory(tx: Db, signal: AbortSignal) {
  await requireCurrentAuthority(tx, signal);
  await lockInventoryCatalog(tx, signal);
  await lockDirectory(tx, "read", signal);
}

async function warehouseScope(tx: Db, actor: HydratedActor, itemId: string, signal: AbortSignal) {
  try {
    await requireItemReleaseAccess(tx, actor, itemId, "view");
  } catch (error) {
    if (error instanceof InventoryDomainError) return null;
    throw error;
  }
  const policy = await catalogItemPolicy(tx, itemId);
  if (policy === null || (actor.type !== "admin" && policy.visibility !== "staff")) return null;
  return readWarehouseAccess(tx, actor, signal);
}

function selectStock(tx: Db) {
  return tx
    .select({ position: stock, version: positionVersion, outputReleaseId: outputs.releaseId })
    .from(stock)
    .leftJoin(
      outputs,
      and(
        eq(stock.buildOutputId, outputs.id),
        eq(stock.itemId, outputs.itemId),
        eq(outputs.status, "completed"),
      ),
    );
}

function activeChanges(tx: Db, itemId: string) {
  return tx
    .select({ id: changes.id, baseReleaseId: changes.baseReleaseId, revision: releases.revision })
    .from(changes)
    .innerJoin(
      releases,
      and(
        eq(releases.id, changes.baseReleaseId),
        eq(releases.itemId, changes.itemId),
        eq(releases.status, "released"),
      ),
    )
    .where(
      and(
        eq(changes.itemId, itemId),
        eq(changes.status, "approved"),
        lte(changes.effectiveAt, sql`clock_timestamp()`),
      ),
    )
    .orderBy(desc(changes.effectiveAt), desc(changes.id));
}

function positionEndpoint(access: WarehouseAccess, position: Position) {
  const site = access.sites.find(({ id }) => id === position.siteId);
  const bin = access.locations.find(
    ({ id, siteId }) => id === position.locationId && siteId === site?.id,
  );
  return site === undefined || bin === undefined ? null : { site, bin };
}

type Endpoint = NonNullable<ReturnType<typeof positionEndpoint>>;

function managedStorage({ site, bin }: Endpoint): boolean {
  return site.canManage && !site.archived && !bin.archived && bin.kind === "storage";
}

function eligibleQuantity(position: Position): boolean {
  return position.onHand > 0 && position.reserved === 0 && position.ownerOrganizationId === null;
}

function historyKey(changeId: string, positionId: string) {
  return `${changeId}:${positionId}`;
}

function readHoldHistory(tx: Db, positionIds: string[], changeIds: string[], siteIds: string[]) {
  const actor = alias(users, "engineering_disposition_actor");
  return tx
    .select({
      changeId: holds.changeId,
      positionId: holds.positionId,
      eventId: events.id,
      action: sql<
        "hold" | "release"
      >`CASE WHEN ${events.id} = ${holds.holdEventId} THEN 'hold' ELSE 'release' END`,
      at: events.createdAt,
      reason: details.reason,
      actor: actor.name,
    })
    .from(holds)
    .innerJoin(events, sql`${events.id} IN (${holds.holdEventId}, ${holds.releaseEventId})`)
    .innerJoin(details, eq(details.eventId, events.id))
    .innerJoin(actor, eq(actor.id, events.actorId))
    .where(
      and(
        inArray(holds.positionId, positionIds),
        inArray(holds.changeId, changeIds),
        inArray(holds.siteId, siteIds),
      ),
    )
    .orderBy(asc(details.sequence));
}

async function projectStock(
  tx: Db,
  access: WarehouseAccess,
  rows: StockRow[],
  applicable: Awaited<ReturnType<typeof activeChanges>>,
): Promise<OldReleasePosition[]> {
  const byRelease = new Map(
    [...applicable].reverse().map((change) => [change.baseReleaseId, change]),
  );
  const attributed = rows.filter(
    ({ outputReleaseId }) => outputReleaseId !== null && byRelease.has(outputReleaseId),
  );
  if (attributed.length === 0) return [];
  const ids = attributed.map(({ position }) => position.id);
  const active = await tx
    .select()
    .from(holds)
    .where(and(inArray(holds.positionId, ids), isNull(holds.releaseEventId)));
  const byHold = new Map(active.map((hold) => [hold.positionId, hold]));
  const byId = new Map(applicable.map((change) => [change.id, change]));
  const history = await readHoldHistory(
    tx,
    ids,
    applicable.map(({ id }) => id),
    access.sites.map(({ id }) => id),
  );
  const histories = new Map<string, OldReleasePosition["history"]>();
  for (const { changeId, positionId, eventId, action, at, reason, actor } of history) {
    if (reason === null) continue;
    const key = historyKey(changeId, positionId);
    const entries = histories.get(key) ?? [];
    entries.push({ id: eventId, action, at: at.toISOString(), actor, reason });
    histories.set(key, entries);
  }
  const blocked = await readDispositionCustodyBlocks(tx, ids);
  return attributed.flatMap(({ position, version, outputReleaseId }) => {
    if (outputReleaseId === null) return [];
    const hold = byHold.get(position.id);
    const change =
      (hold === undefined ? undefined : byId.get(hold.changeId)) ?? byRelease.get(outputReleaseId);
    const endpoint = positionEndpoint(access, position);
    if (change === undefined || endpoint === null) return [];
    const status = dispositionStatus(position, change.id, hold);
    return [
      {
        id: position.id,
        changeId: change.id,
        version,
        revision: change.revision,
        site: endpoint.site.name,
        location: endpoint.bin.name,
        lot: position.lot,
        serial: position.serial,
        quantity: String(position.onHand),
        reserved: String(position.reserved),
        status,
        canDispose:
          status !== "unavailable" &&
          managedStorage(endpoint) &&
          eligibleQuantity(position) &&
          !blocked.has(position.id),
        history: histories.get(historyKey(change.id, position.id)) ?? [],
      },
    ];
  });
}

function dispositionStatus(
  position: Position,
  changeId: string,
  hold: Hold | undefined,
): OldReleasePosition["status"] {
  if (position.state === "available" && hold === undefined) return "available";
  if (position.state === "hold" && hold?.changeId === changeId) return "held";
  return "unavailable";
}

/** Takes the Catalog and Directory locks before the product for a coherent, site-scoped view. */
export async function readEngineeringStock(
  tx: Db,
  actor: HydratedActor,
  itemId: string,
  signal: AbortSignal,
): Promise<EngineeringChangeWorkspace["stock"]> {
  await lockDispositionDirectory(tx, signal);
  await lockReleaseArtifactItem(tx, itemId, "share");
  const access = await warehouseScope(tx, actor, itemId, signal);
  if (access === null || access.sites.length === 0) return null;
  const applicable = await activeChanges(tx, itemId);
  const rows = await selectStock(tx)
    .where(
      and(
        eq(stock.itemId, itemId),
        inArray(
          stock.siteId,
          access.sites.map(({ id }) => id),
        ),
        gt(stock.onHand, 0),
      ),
    )
    .orderBy(
      asc(stock.siteId),
      asc(stock.locationId),
      asc(stock.lot),
      asc(stock.serial),
      asc(stock.id),
    );
  signal.throwIfAborted();
  return {
    positions: await projectStock(tx, access, rows, applicable),
    unattributed: rows.some(({ position }) => position.buildOutputId === null),
  };
}

async function lockDispositionTarget(
  tx: Db,
  actor: HydratedActor,
  command: Disposition,
  signal: AbortSignal,
) {
  await lockDispositionDirectory(tx, signal);
  const { itemId, changeId, positionId } = command;
  if (!(await lockInventoryStock(tx, [itemId])).has(itemId)) fail("unavailable");
  const access = await warehouseScope(tx, actor, itemId, signal);
  if (access === null) fail("unavailable");
  const managedSites = access.sites.filter(({ canManage, archived }) => canManage && !archived);
  if (managedSites.length === 0) fail("unavailable");
  const [row] = await selectStock(tx)
    .innerJoin(
      changes,
      and(
        eq(changes.id, changeId),
        eq(changes.itemId, itemId),
        eq(changes.baseReleaseId, outputs.releaseId),
        eq(changes.status, "approved"),
        lte(changes.effectiveAt, sql`clock_timestamp()`),
      ),
    )
    .innerJoin(
      releases,
      and(
        eq(releases.id, outputs.releaseId),
        eq(releases.itemId, itemId),
        eq(releases.status, "released"),
      ),
    )
    .where(
      and(
        eq(stock.id, positionId),
        eq(stock.itemId, itemId),
        inArray(
          stock.siteId,
          managedSites.map(({ id }) => id),
        ),
      ),
    );
  if (row === undefined || row.outputReleaseId === null || row.position.buildOutputId === null)
    fail("stockUnavailable");
  const endpoint = positionEndpoint(access, row.position);
  if (endpoint === null || !managedStorage(endpoint)) fail("stockUnavailable");
  signal.throwIfAborted();
  return { ...row, buildOutputId: row.position.buildOutputId, baseReleaseId: row.outputReleaseId };
}

/** Resolve exact current write scope and serialize request lookup; replay does not repeat CAS. */
export async function authorizeEngineeringDispositionReplay(
  tx: Db,
  actor: HydratedActor,
  command: Disposition,
  signal: AbortSignal,
) {
  await lockDispositionTarget(tx, actor, command, signal);
  return { changeId: command.changeId };
}

async function appendDispositionEvent(
  tx: Db,
  actor: HydratedActor,
  command: Disposition,
  position: Position,
  state: "hold" | "available",
) {
  return addOperationEvent(
    tx,
    actor,
    command,
    {
      itemId: position.itemId,
      positionId: position.id,
      kind: "engineering-disposition",
      previousState: position.state,
      state,
      createdAt: await readEngineeringTime(tx),
    },
    {
      siteId: position.siteId,
      locationId: position.locationId,
      previousOnHand: position.onHand,
    },
  );
}

export async function applyEngineeringDisposition(
  tx: Db,
  actor: HydratedActor,
  command: Disposition,
  signal: AbortSignal,
) {
  const { position, version, buildOutputId, baseReleaseId } = await lockDispositionTarget(
    tx,
    actor,
    command,
    signal,
  );
  if (version !== command.expectedPositionVersion) fail("conflict");
  if (
    !eligibleQuantity(position) ||
    (await readDispositionCustodyBlocks(tx, [position.id])).size > 0
  )
    fail("stockUnavailable");
  const [hold] = await tx
    .select()
    .from(holds)
    .where(and(eq(holds.positionId, position.id), isNull(holds.releaseEventId)))
    .for("update");
  const status = dispositionStatus(position, command.changeId, hold);
  if (command.action === "hold") {
    if (status !== "available") fail("stockUnavailable");
    await movePositionState(tx, position, "hold", position.onHand);
    const holdEventId = await appendDispositionEvent(tx, actor, command, position, "hold");
    await tx.insert(holds).values({
      changeId: command.changeId,
      itemId: position.itemId,
      siteId: position.siteId,
      positionId: position.id,
      buildOutputId,
      baseReleaseId,
      holdEventId,
    });
  } else {
    if (status !== "held" || hold === undefined) fail("stockUnavailable");
    const releaseEventId = await appendDispositionEvent(tx, actor, command, position, "available");
    await tx.update(holds).set({ releaseEventId }).where(eq(holds.id, hold.id));
    await movePositionState(tx, position, "available", position.onHand);
  }
  return { changeId: command.changeId };
}
