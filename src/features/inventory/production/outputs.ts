import { and, asc, eq, gt, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  hasPendingBuildInspection,
  qualityPlanForBuild,
  registerQualityTarget,
} from "../quality/gates";
import { lockInventoryStock } from "../stock";
import { readStockPositionRows } from "../warehouse/balances";
import {
  inventoryStockEventDetails,
  inventoryStockEvents,
  inventoryStockPositions,
} from "../warehouse/schema";
import { consumeBatchMaterials, readBuildMaterials } from "./allocations";
import {
  inventoryProductionBuilds,
  inventoryProductionOutputs,
  type ProductionBuildRow,
} from "./buildSchema";
import type { ExistingProductionCommand } from "./contracts";
import { failProduction } from "./failure";
import { inventoryProductionInputs } from "./materialSchema";
import {
  currentProductionPolicy,
  type ProductionStockDelta,
  type ProductionStockLocks,
  productionStockUnits,
  requireStorageBin,
  writeProductionStock,
} from "./stock";

type Output = typeof inventoryProductionOutputs.$inferSelect;
type BatchId = { outputId: string };
type Operation<T extends ExistingProductionCommand["type"]> = Extract<
  ExistingProductionCommand,
  { type: T }
>;

async function readOutput(tx: Db, buildId: string, { outputId }: BatchId) {
  const [row] = await tx
    .select()
    .from(inventoryProductionOutputs)
    .where(
      and(
        eq(inventoryProductionOutputs.id, outputId),
        eq(inventoryProductionOutputs.buildId, buildId),
      ),
    );
  if (row === undefined) failProduction("unavailable");
  return row;
}

async function settleOutput(
  tx: Db,
  actorId: string,
  output: Output,
  values: {
    status: "completed" | "scrapped" | "cancelled";
    reason: string;
    lot?: string | null;
    serials?: string[];
  },
) {
  const [updated] = await tx
    .update(inventoryProductionOutputs)
    .set({
      ...values,
      settledBy: actorId,
      settledAt: sql`clock_timestamp()`,
    })
    .where(
      and(
        eq(inventoryProductionOutputs.id, output.id),
        eq(inventoryProductionOutputs.status, "wip"),
      ),
    )
    .returning({ id: inventoryProductionOutputs.id });
  if (updated === undefined) failProduction("state");
}

export async function startProductionBatch(
  tx: Db,
  actorId: string,
  build: ProductionBuildRow,
  quantity: number,
) {
  await requireStorageBin(tx, build.siteId, build.locationId);
  const [row] = await tx
    .select({
      quantity: sql<number>`coalesce(sum(${inventoryProductionOutputs.quantity}), 0)::int`,
    })
    .from(inventoryProductionOutputs)
    .where(
      and(
        eq(inventoryProductionOutputs.buildId, build.id),
        eq(inventoryProductionOutputs.status, "wip"),
      ),
    );
  if (quantity > build.quantity - build.completed - build.scrapped - (row?.quantity ?? 0))
    failProduction("stock");
  if (build.trackable && quantity > 500) failProduction("limit");
  const [created] = await tx
    .insert(inventoryProductionOutputs)
    .values({
      buildId: build.id,
      itemId: build.itemId,
      releaseId: build.releaseId,
      status: "wip",
      quantity,
      createdBy: actorId,
    })
    .returning({ id: inventoryProductionOutputs.id });
  if (created === undefined) failProduction("stale");
}

export async function cancelProductionBatch(
  tx: Db,
  actorId: string,
  build: ProductionBuildRow,
  command: Operation<"cancelBatch">,
) {
  const output = await readOutput(tx, build.id, command);
  await settleOutput(tx, actorId, output, { status: "cancelled", reason: command.reason });
}

export async function cancelOpenProductionBatches(
  tx: Db,
  actorId: string,
  build: ProductionBuildRow,
  reason: string,
) {
  await tx
    .update(inventoryProductionOutputs)
    .set({ status: "cancelled", reason, settledBy: actorId, settledAt: sql`clock_timestamp()` })
    .where(
      and(
        eq(inventoryProductionOutputs.buildId, build.id),
        eq(inventoryProductionOutputs.status, "wip"),
      ),
    );
}

function validateOutputIdentities(
  build: ProductionBuildRow,
  output: Output,
  command: Operation<"finalizeBatch">,
) {
  if (command.disposition === "scrapped") {
    if (command.lot !== null || command.serials.length > 0) failProduction("invalid");
    return;
  }
  if (command.lot === null) failProduction("invalid");
  if (build.trackable || command.serials.length > 0) {
    if (command.serials.length !== output.quantity) failProduction("serial");
  }
}

async function publishProductionStock(
  tx: Db,
  actorId: string,
  build: ProductionBuildRow,
  output: Output,
  command: Operation<"finalizeBatch">,
  stock: ProductionStockLocks,
  planVersionId: string | null,
) {
  // Establish every zero balance first. A duplicate serial aborts the entire batch,
  // including consumed inputs, settled output metadata, and the command receipt.
  const serials = command.serials.length === 0 ? [null] : command.serials;
  const positions = await tx
    .insert(inventoryStockPositions)
    .values(
      serials.map((serial) => ({
        itemId: build.itemId,
        siteId: build.siteId,
        locationId: build.locationId,
        lot: command.lot,
        serial,
        buildOutputId: output.id,
        state: planVersionId === null ? ("available" as const) : ("hold" as const),
        onHand: 0,
        reserved: 0,
      })),
    )
    .onConflictDoNothing()
    .returning();
  if (positions.length !== serials.length) failProduction("serial");
  for (const position of positions) {
    await writeProductionStock(tx, actorId, command.requestId, stock, "production-output", {
      position,
      onHandDelta: position.serial === null ? output.quantity : 1,
      reservedDelta: 0,
    });
    if (planVersionId !== null)
      await registerQualityTarget(tx, build, output.id, position, planVersionId);
  }
}

export async function finalizeProductionBatch(
  tx: Db,
  actorId: string,
  build: ProductionBuildRow,
  command: Operation<"finalizeBatch">,
  signal: AbortSignal,
) {
  const output = await readOutput(tx, build.id, command);
  if (
    output.status !== "wip" ||
    output.quantity > build.quantity - build.completed - build.scrapped
  )
    failProduction("state");
  validateOutputIdentities(build, output, command);
  const planVersionId =
    command.disposition === "completed" ? await qualityPlanForBuild(tx, build) : null;
  if (planVersionId !== null && command.serials.length !== output.quantity)
    failProduction("serial");
  const materials = await readBuildMaterials(tx, build.id);
  const stock = await lockInventoryStock(tx, [
    build.itemId,
    ...materials.map(({ itemId }) => itemId),
  ]);
  if (command.disposition === "completed") {
    await requireStorageBin(tx, build.siteId, build.locationId);
    const policy = await currentProductionPolicy(tx, build.itemId);
    if (policy.flags.trackable !== build.trackable) failProduction("serial");
    const currentUnit =
      (await productionStockUnits(tx, [build.itemId])).get(build.itemId) ?? "each";
    if (currentUnit !== build.stockUnit) failProduction("unitChanged");
  }
  await consumeBatchMaterials(
    tx,
    actorId,
    command.requestId,
    build,
    output,
    stock,
    materials,
    signal,
  );
  await settleOutput(tx, actorId, output, {
    status: command.disposition,
    reason: command.reason,
    lot: command.lot,
    serials: command.serials,
  });
  if (command.disposition === "completed")
    await publishProductionStock(tx, actorId, build, output, command, stock, planVersionId);
  const completed = build.completed + (command.disposition === "completed" ? output.quantity : 0);
  const scrapped = build.scrapped + (command.disposition === "scrapped" ? output.quantity : 0);
  const canClose =
    completed + scrapped === build.quantity && !(await hasPendingBuildInspection(tx, build.id));
  await tx
    .update(inventoryProductionBuilds)
    .set({
      completed,
      scrapped,
      status: canClose ? "closed" : build.status,
    })
    .where(eq(inventoryProductionBuilds.id, build.id));
}

async function hasLaterPositionEvent(tx: Db, positionId: string, sequence: bigint) {
  const [latest] = await tx
    .select({ id: inventoryStockEvents.id })
    .from(inventoryStockEvents)
    .innerJoin(
      inventoryStockEventDetails,
      eq(inventoryStockEventDetails.eventId, inventoryStockEvents.id),
    )
    .where(
      and(
        gt(inventoryStockEventDetails.sequence, sequence),
        or(
          eq(inventoryStockEvents.positionId, positionId),
          eq(inventoryStockEvents.sourcePositionId, positionId),
        ),
      ),
    )
    .limit(1);
  return latest !== undefined;
}

async function pristineProductionStock(tx: Db, build: ProductionBuildRow, output: Output) {
  if (output.status !== "completed") return [];
  const rows = await tx
    .select({
      position: inventoryStockPositions,
      event: inventoryStockEvents,
      details: inventoryStockEventDetails,
    })
    .from(inventoryStockPositions)
    .innerJoin(
      inventoryStockEvents,
      and(
        eq(inventoryStockEvents.positionId, inventoryStockPositions.id),
        eq(inventoryStockEvents.kind, "production-output"),
      ),
    )
    .innerJoin(
      inventoryStockEventDetails,
      eq(inventoryStockEventDetails.eventId, inventoryStockEvents.id),
    )
    .where(eq(inventoryStockPositions.buildOutputId, output.id))
    .orderBy(asc(inventoryStockPositions.id));
  const expectedPositions = output.serials.length || 1;
  if (
    rows.length !== expectedPositions ||
    rows.reduce((total, row) => total + row.event.onHandDelta, 0) !== output.quantity
  ) {
    failProduction("reversal");
  }
  const deltas: ProductionStockDelta[] = [];
  for (const { position, event, details } of rows) {
    if (
      position.reserved !== 0 ||
      position.siteId !== build.siteId ||
      position.locationId !== build.locationId ||
      position.onHand !== event.onHandDelta ||
      details.previousOnHand !== 0 ||
      details.locationId !== position.locationId ||
      position.state !== "available" ||
      (await hasLaterPositionEvent(tx, position.id, details.sequence))
    ) {
      failProduction("reversal");
    }
    deltas.push({
      position,
      onHandDelta: -event.onHandDelta,
      reservedDelta: 0,
      reversesEventId: event.id,
    });
  }
  return deltas;
}

function readConsumedProductionInputs(tx: Db, outputId: string) {
  return tx
    .select({
      input: inventoryProductionInputs,
      event: inventoryStockEvents,
      details: inventoryStockEventDetails,
    })
    .from(inventoryProductionInputs)
    .innerJoin(inventoryStockEvents, eq(inventoryStockEvents.id, inventoryProductionInputs.eventId))
    .innerJoin(
      inventoryStockEventDetails,
      eq(inventoryStockEventDetails.eventId, inventoryStockEvents.id),
    )
    .where(eq(inventoryProductionInputs.outputId, outputId))
    .orderBy(asc(inventoryProductionInputs.positionId), asc(inventoryProductionInputs.materialId));
}

async function returnableProductionInputs(
  tx: Db,
  build: ProductionBuildRow,
  inputs: Awaited<ReturnType<typeof readConsumedProductionInputs>>,
) {
  const itemIds = [...new Set(inputs.map(({ input }) => input.itemId))];
  const rows = await readStockPositionRows(tx, itemIds, [build.siteId]);
  const positions = new Map(rows.map((row) => [row.id, row]));
  const deltas: ProductionStockDelta[] = [];
  for (const { input, event, details } of inputs) {
    const position = positions.get(input.positionId);
    if (
      position === undefined ||
      position.locationArchived ||
      position.siteArchived ||
      position.locationKind !== "storage" ||
      position.locationId !== details.locationId ||
      position.siteId !== details.siteId ||
      position.ownerOrganizationId !== null ||
      event.kind !== "production-consume" ||
      event.onHandDelta !== -input.quantity ||
      event.reservedDelta !== -input.quantity
    ) {
      failProduction("reversal");
    }
    if (
      position.serial !== null &&
      (input.quantity !== 1 ||
        position.onHand !== 0 ||
        position.reserved !== 0 ||
        (await hasLaterPositionEvent(tx, position.id, details.sequence)))
    )
      failProduction("reversal");
    deltas.push({
      position,
      onHandDelta: input.quantity,
      reservedDelta: 0,
      reversesEventId: event.id,
    });
  }
  return deltas;
}

export async function reverseProductionOutput(
  tx: Db,
  actorId: string,
  build: ProductionBuildRow,
  command: Operation<"reverseOutput">,
) {
  const output = await readOutput(tx, build.id, command);
  if (output.status !== "completed" && output.status !== "scrapped") failProduction("reversal");
  const inputs = await readConsumedProductionInputs(tx, output.id);
  const stock = await lockInventoryStock(tx, [
    build.itemId,
    ...inputs.map(({ input }) => input.itemId),
  ]);
  const deltas = [
    ...(await pristineProductionStock(tx, build, output)),
    ...(await returnableProductionInputs(tx, build, inputs)),
  ];
  for (const delta of deltas)
    await writeProductionStock(tx, actorId, command.requestId, stock, "production-reversal", delta);
  const completed = build.completed - (output.status === "completed" ? output.quantity : 0);
  const scrapped = build.scrapped - (output.status === "scrapped" ? output.quantity : 0);
  await tx
    .update(inventoryProductionOutputs)
    .set({ status: "reversed", reversedBy: actorId, reversedAt: sql`clock_timestamp()` })
    .where(eq(inventoryProductionOutputs.id, output.id));
  await tx
    .update(inventoryProductionBuilds)
    .set({ completed, scrapped, status: build.status === "closed" ? "issued" : build.status })
    .where(eq(inventoryProductionBuilds.id, build.id));
}
