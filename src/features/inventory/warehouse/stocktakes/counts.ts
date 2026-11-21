import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  ne,
  notExists,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import type { Db } from "@/db/client";
import { users } from "@/db/schema/identity";
import { inventoryPartFamilies, inventoryPartProfiles } from "../../catalog/schema";
import { inventoryItems } from "../../schema";
import { lockInventoryStock } from "../../stock";
import { managedWarehouseLocation, requireWarehouseOwner } from "../access";
import { correctStock } from "../operations/corrections";
import type { OperationsActor } from "../operations/shared";
import {
  inventoryStockEventDetails,
  inventoryStockEvents,
  inventoryStockPositions,
} from "../schema";
import {
  type CountCommand,
  maxPositionCount,
  type StocktakeDetail,
  type StocktakeSummary,
} from "./contracts";
import { inventoryStocktakeLines, inventoryStocktakes } from "./countSchema";
import { failStocktake } from "./errors";

type Header = typeof inventoryStocktakes.$inferSelect;
type StartCount = Extract<CountCommand, { type: "startCount" }>;
type RecordCounts = Extract<CountCommand, { type: "recordCounts" }>;
type ReconcileCount = Extract<CountCommand, { type: "reconcileCount" }>;

const headers = inventoryStocktakes;
const lines = inventoryStocktakeLines;
const positions = inventoryStockPositions;
const events = inventoryStockEvents;
const details = inventoryStockEventDetails;

function visibilityFence(tx: Db, actor: OperationsActor) {
  return notExists(
    tx
      .select({ id: lines.id })
      .from(lines)
      .leftJoin(inventoryPartProfiles, eq(inventoryPartProfiles.itemId, lines.itemId))
      .where(
        and(
          eq(lines.stocktakeId, headers.id),
          or(
            actor.access.isAdmin ? undefined : eq(inventoryPartProfiles.visibility, "admin"),
            and(
              isNotNull(lines.ownerOrganizationId),
              notInArray(
                lines.ownerOrganizationId,
                actor.access.organizations.map(({ id }) => id),
              ),
            ),
          ),
        ),
      ),
  );
}

async function lockStocktake(tx: Db, actor: OperationsActor, id: string) {
  const sites = actor.access.sites.filter(({ canManage }) => canManage).map(({ id }) => id);
  const [header] = await tx
    .select()
    .from(headers)
    .where(and(eq(headers.id, id), inArray(headers.siteId, sites), visibilityFence(tx, actor)))
    .for("update");
  if (header === undefined) failStocktake("unavailable");
  return header;
}

function stockChangingEvents() {
  return or(
    ne(events.onHandDelta, 0),
    ne(events.reservedDelta, 0),
    eq(events.kind, "state"),
    eq(events.kind, "production-accept"),
  );
}

/** The bin watermark also detects transient arrivals that have already left the current cohort. */
async function binSequence(tx: Db, siteId: string, locationId: string) {
  const [row] = await tx
    .select({ sequence: sql<string>`coalesce(max(${details.sequence}), 0)::text` })
    .from(details)
    .innerJoin(events, eq(events.id, details.eventId))
    .where(
      and(eq(details.siteId, siteId), eq(details.locationId, locationId), stockChangingEvents()),
    );
  return BigInt(row?.sequence ?? "0");
}

async function readCohort(tx: Db, actor: OperationsActor, siteId: string, locationId: string) {
  const rows = await tx
    .select({
      positionId: positions.id,
      itemId: positions.itemId,
      expectedOnHand: positions.onHand,
      reserved: positions.reserved,
      lot: positions.lot,
      serial: positions.serial,
      expiryDate: positions.expiryDate,
      ownerOrganizationId: positions.ownerOrganizationId,
      state: positions.state,
      code: sql<string>`coalesce(${inventoryPartFamilies.code}, ${inventoryItems.sku})`,
      name: inventoryItems.name,
      revision: inventoryItems.revision,
      visibility: inventoryPartProfiles.visibility,
      eventSequence: sql<string>`coalesce((
        SELECT max(${details.sequence})
        FROM ${events}
        INNER JOIN ${details} ON ${details.eventId} = ${events.id}
        WHERE (${events.positionId} = ${positions.id} OR ${events.sourcePositionId} = ${positions.id})
          AND ${stockChangingEvents()}
      ), 0)::text`,
    })
    .from(positions)
    .innerJoin(inventoryItems, eq(inventoryItems.id, positions.itemId))
    .leftJoin(inventoryPartProfiles, eq(inventoryPartProfiles.itemId, positions.itemId))
    .leftJoin(inventoryPartFamilies, eq(inventoryPartFamilies.id, inventoryPartProfiles.familyId))
    .where(
      and(
        eq(positions.siteId, siteId),
        eq(positions.locationId, locationId),
        gt(positions.onHand, 0),
      ),
    )
    .orderBy(asc(positions.id))
    .limit(maxPositionCount + 1);
  const cohort = rows.map(({ eventSequence, visibility, ...row }) => {
    if (visibility === "admin" && !actor.access.isAdmin) failStocktake("unavailable");
    requireWarehouseOwner(actor.access, row.ownerOrganizationId);
    return { ...row, eventSequence: BigInt(eventSequence) };
  });
  if (cohort.length > maxPositionCount) failStocktake("limit");
  return cohort;
}

function requireActiveBin(access: ReturnType<typeof managedWarehouseLocation>) {
  if (access.site.archived || access.location.archived || access.location.kind !== "storage") {
    failStocktake("unavailable");
  }
}

async function startStocktake(
  tx: Db,
  actor: OperationsActor,
  command: StartCount,
  access: ReturnType<typeof managedWarehouseLocation>,
) {
  requireActiveBin(access);
  const { requestId: id, locationId, note } = command;
  const { site, location } = access;
  const cohort = await readCohort(tx, actor, site.id, locationId);
  const binEventSequence = await binSequence(tx, site.id, locationId);
  const [inserted] = await tx
    .insert(headers)
    .values({
      id,
      siteId: site.id,
      locationId,
      locationName: location.name,
      note,
      binEventSequence,
      createdBy: actor.id,
    })
    .onConflictDoNothing()
    .returning({ id: headers.id });
  if (inserted === undefined) failStocktake("conflict");
  if (cohort.length > 0) {
    await tx.insert(lines).values(cohort.map((row) => ({ ...row, stocktakeId: id })));
  }
  return id;
}

function readCountLines(tx: Db, stocktakeId: string) {
  return tx
    .select()
    .from(lines)
    .where(eq(lines.stocktakeId, stocktakeId))
    .orderBy(asc(lines.positionId));
}

async function recordCounts(tx: Db, actor: OperationsActor, command: RecordCounts, header: Header) {
  const current = new Map((await readCountLines(tx, header.id)).map((line) => [line.id, line]));
  const countedAt = new Date();
  const seen = new Set<string>();
  for (const count of command.counts) {
    const line = current.get(count.lineId);
    if (
      line === undefined ||
      seen.has(count.lineId) ||
      (line.serial !== null && count.countedQuantity > 1) ||
      (count.countedQuantity !== line.expectedOnHand && count.reason === null)
    ) {
      failStocktake("invalid");
    }
    seen.add(count.lineId);
  }
  for (const { lineId, countedQuantity, reason } of command.counts) {
    await tx
      .update(lines)
      .set({ countedQuantity, reason, countedBy: actor.id, countedAt })
      .where(eq(lines.id, lineId));
  }
  await tx
    .update(headers)
    .set({ version: header.version + 1 })
    .where(eq(headers.id, header.id));
}

/** Verify every observation and every baseline before recording the first correction. */
async function prepareReconciliation(tx: Db, actor: OperationsActor, header: Header) {
  const captured = await readCountLines(tx, header.id);
  await lockInventoryStock(
    tx,
    captured.map(({ itemId }) => itemId),
  );
  const current = await readCohort(tx, actor, header.siteId, header.locationId);
  const sequence = await binSequence(tx, header.siteId, header.locationId);
  if (captured.length !== current.length || sequence !== header.binEventSequence) {
    failStocktake("stale");
  }
  return captured.map((line, index) => {
    const position = current[index];
    if (
      position?.positionId !== line.positionId ||
      position.itemId !== line.itemId ||
      position.expectedOnHand !== line.expectedOnHand ||
      position.reserved !== line.reserved ||
      position.state !== line.state ||
      position.lot !== line.lot ||
      position.serial !== line.serial ||
      position.expiryDate !== line.expiryDate ||
      position.ownerOrganizationId !== line.ownerOrganizationId ||
      position.eventSequence !== line.eventSequence
    ) {
      failStocktake("stale");
    }
    if (line.countedQuantity === null || line.countedAt === null || line.countedBy === null) {
      failStocktake("invalid");
    }
    return {
      ...line,
      countedQuantity: line.countedQuantity,
      delta: line.countedQuantity - line.expectedOnHand,
    };
  });
}

async function reconcileCount(
  tx: Db,
  actor: OperationsActor,
  command: ReconcileCount,
  header: Header,
) {
  const observations = await prepareReconciliation(tx, actor, header);
  // Reductions free capacity first when one SKU is split across multiple positions.
  for (const line of observations.sort((a, b) => a.delta - b.delta)) {
    if (line.delta === 0) continue;
    if (line.reason === null) failStocktake("invalid");
    const correctionEventId = await correctStock(tx, actor, {
      type: "correctStock",
      requestId: command.requestId,
      locationId: header.locationId,
      positionId: line.positionId,
      expectedOnHand: line.expectedOnHand,
      countedQuantity: line.countedQuantity,
      reason: line.reason,
    });
    await tx.update(lines).set({ correctionEventId }).where(eq(lines.id, line.id));
  }
  await closeStocktake(tx, actor, header, "reconciled", null);
}

async function closeStocktake(
  tx: Db,
  actor: OperationsActor,
  header: Header,
  status: "reconciled" | "cancelled",
  cancellationReason: string | null,
) {
  await tx
    .update(headers)
    .set({
      status,
      cancellationReason,
      closedAt: new Date(),
      closedBy: actor.id,
      version: header.version + 1,
    })
    .where(eq(headers.id, header.id));
}

/** Called under the exclusive directory fence and shared catalog fence. */
export async function prepareCountCommand(
  tx: Db,
  actor: OperationsActor,
  command: CountCommand,
): Promise<() => Promise<string>> {
  if (command.type === "startCount") {
    const access = managedWarehouseLocation(actor.access, command.locationId);
    return () => startStocktake(tx, actor, command, access);
  }
  const header = await lockStocktake(tx, actor, command.stocktakeId);
  const access = managedWarehouseLocation(actor.access, header.locationId);
  return async () => {
    if (header.version !== command.expectedVersion || header.status !== "draft") {
      failStocktake("stale");
    }
    if (command.type !== "cancelCount") requireActiveBin(access);
    switch (command.type) {
      case "recordCounts":
        await recordCounts(tx, actor, command, header);
        break;
      case "reconcileCount":
        await reconcileCount(tx, actor, command, header);
        break;
      case "cancelCount":
        await closeStocktake(tx, actor, header, "cancelled", command.reason);
        break;
    }
    return header.id;
  };
}

function summary(row: Header): StocktakeSummary {
  return {
    id: row.id,
    locationId: row.locationId,
    locationName: row.locationName,
    note: row.note,
    status: row.status,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
  };
}

function countProjection(tx: Db, stocktakeId: string) {
  return tx
    .select({
      id: lines.id,
      positionId: lines.positionId,
      itemId: lines.itemId,
      code: lines.code,
      name: lines.name,
      revision: lines.revision,
      lot: lines.lot,
      serial: lines.serial,
      expectedOnHand: lines.expectedOnHand,
      reserved: lines.reserved,
      countedQuantity: lines.countedQuantity,
      reason: lines.reason,
      countedAt: lines.countedAt,
      countedBy: users.name,
      correctionEventId: lines.correctionEventId,
    })
    .from(lines)
    .leftJoin(users, eq(users.id, lines.countedBy))
    .where(eq(lines.stocktakeId, stocktakeId))
    .orderBy(
      asc(lines.code),
      asc(lines.revision),
      asc(lines.lot),
      asc(lines.serial),
      asc(lines.id),
    );
}

export async function readStocktakeCounts(
  tx: Db,
  actor: OperationsActor,
  siteId: string,
  stocktakeId?: string,
): Promise<{ stocktakes: StocktakeSummary[]; stocktake: StocktakeDetail | null }> {
  if (!actor.access.sites.some(({ id }) => id === siteId)) failStocktake("unavailable");
  const rows = await tx
    .select()
    .from(headers)
    .where(and(eq(headers.siteId, siteId), visibilityFence(tx, actor)))
    .orderBy(desc(headers.createdAt), desc(headers.id));
  const stocktakes = rows.map(summary);
  const current = stocktakeId === undefined ? rows[0] : rows.find(({ id }) => id === stocktakeId);
  if (current === undefined) {
    if (stocktakeId !== undefined) failStocktake("unavailable");
    return { stocktakes, stocktake: null };
  }
  const captured = await countProjection(tx, current.id);
  return {
    stocktakes,
    stocktake: {
      ...summary(current),
      lines: captured.map((line) => ({
        ...line,
        countedAt: line.countedAt?.toISOString() ?? null,
      })),
    },
  };
}
