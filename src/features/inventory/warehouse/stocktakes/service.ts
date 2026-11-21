import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { lockDirectory } from "@/features/locations/service";
import { currentInventoryActor } from "../../access";
import { lockInventoryCatalog } from "../../catalog/policy";
import { inventoryCommandReceipts } from "../../schema";
import { InventoryStockError } from "../../stock";
import { readWarehouseAccess, WarehouseFailure } from "../access";
import type { OperationsActor } from "../operations/shared";
import { WarehouseOperationsFailure } from "../operations/shared";
import {
  type StocktakeCommand,
  type StocktakeCommandResult,
  type StocktakeQuery,
  type StocktakeResult,
  stocktakeCommand,
} from "./contracts";
import { prepareCountCommand, readStocktakeCounts } from "./counts";
import { failStocktake, StocktakeFailure } from "./errors";
import { readStocktakeSites } from "./scope";
import { captureValuation, readValuations } from "./valuations";

const denied = { ok: false, error: "unavailable" } as const;

async function claimStocktakeCommand(tx: Db, actorId: string, command: StocktakeCommand) {
  const fingerprint = createHash("sha256")
    .update("warehouse-stocktakes-v1:")
    .update(JSON.stringify(command))
    .digest("hex");
  const table = inventoryCommandReceipts;
  const [receipt] = await tx
    .insert(table)
    .values({ actorId, requestId: command.requestId, fingerprint })
    .onConflictDoNothing()
    .returning({ requestId: table.requestId });
  if (receipt !== undefined) return true;
  const [prior] = await tx
    .select({ fingerprint: table.fingerprint })
    .from(table)
    .where(and(eq(table.actorId, actorId), eq(table.requestId, command.requestId)));
  if (prior?.fingerprint !== fingerprint) failStocktake("conflict");
  return false;
}

async function applyStocktakeCommand(
  tx: Db,
  actor: OperationsActor,
  command: StocktakeCommand,
  signal: AbortSignal,
): Promise<string> {
  if (command.type === "captureValuation") {
    const sites = await readStocktakeSites(tx, actor);
    if (sites.find(({ id }) => id === command.siteId)?.canCaptureValues !== true) {
      failStocktake("unavailable");
    }
    return (await claimStocktakeCommand(tx, actor.id, command))
      ? captureValuation(tx, actor, command, signal)
      : command.requestId;
  }
  const apply = await prepareCountCommand(tx, actor, command);
  if (await claimStocktakeCommand(tx, actor.id, command)) return apply();
  return command.type === "startCount" ? command.requestId : command.stocktakeId;
}

function domainError(error: unknown): Exclude<StocktakeCommandResult, { ok: true }> {
  if (error instanceof StocktakeFailure) return { ok: false, error: error.code };
  if (error instanceof WarehouseFailure) return denied;
  if (error instanceof InventoryStockError) return { ok: false, error: "invalid" };
  if (error instanceof WarehouseOperationsFailure) {
    switch (error.code) {
      case "unavailable":
      case "incompatibleLocation":
        return denied;
      case "stale":
      case "conflict":
        return { ok: false, error: error.code };
      case "assemblyLimit":
        return { ok: false, error: "limit" };
      case "alreadyReversed":
      case "incompatibleStock":
      case "insufficientStock":
      case "invalid":
        return { ok: false, error: "invalid" };
    }
  }
  throw error;
}

export async function runStocktakeCommand(
  db: Db,
  who: NativeSessionRef,
  raw: unknown,
  signal: AbortSignal,
): Promise<StocktakeCommandResult> {
  const parsed = stocktakeCommand.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  try {
    return await withCurrentAuthority(db, "read", signal, async (tx) => {
      await lockInventoryCatalog(tx, signal);
      // Freeze the physical cohort during capture or reconciliation, including receipts of a new SKU.
      await lockDirectory(tx, "write", signal);
      const staff = await currentInventoryActor(tx, who, signal);
      if (staff === null) return denied;
      const actor = { id: staff.id, access: await readWarehouseAccess(tx, staff, signal) };
      const id = await applyStocktakeCommand(tx, actor, parsed.data, signal);
      if ((await currentInventoryActor(tx, who, signal)) === null) failStocktake("unavailable");
      return { ok: true, id };
    });
  } catch (error) {
    return domainError(error);
  }
}

async function projectStocktakeWorkspace(
  tx: Db,
  actor: OperationsActor,
  query: StocktakeQuery,
): Promise<StocktakeResult> {
  const sites = await readStocktakeSites(tx, actor);
  if (sites.length === 0 && !actor.access.isAdmin) return denied;
  const site =
    query.siteId === undefined
      ? (sites.find(({ archived }) => !archived) ?? sites[0])
      : sites.find(({ id }) => id === query.siteId);
  if (site === undefined) {
    if (
      query.siteId !== undefined ||
      query.stocktakeId !== undefined ||
      query.valuationId !== undefined
    )
      return denied;
    return {
      ok: true,
      value: { sites, selectedSiteId: null, locations: [], stocktakes: [], stocktake: null },
    };
  }
  const hasWarehouse = site.canReadCounts;
  if (
    (query.stocktakeId !== undefined && !hasWarehouse) ||
    (query.valuationId !== undefined && !site.canReadValues)
  )
    return denied;
  const counts = hasWarehouse
    ? await readStocktakeCounts(tx, actor, site.id, query.stocktakeId)
    : { stocktakes: [], stocktake: null };
  const locations = actor.access.locations
    .filter((row) => row.siteId === site.id && !row.archived && row.kind === "storage")
    .map(({ id, name, code }) => ({ id, name, code }));
  const workspace = { sites, selectedSiteId: site.id, locations, ...counts };
  if (!site.canReadValues) return { ok: true, value: workspace };
  const valuationAccess = await readValuations(tx, actor, site.id, query.valuationId);
  return { ok: true, value: { ...workspace, valuationAccess } };
}

export async function readStocktakeWorkspace(
  db: Db,
  who: NativeSessionRef,
  query: StocktakeQuery,
  signal: AbortSignal,
): Promise<StocktakeResult> {
  try {
    return await withCurrentAuthority(db, "read", signal, async (tx) => {
      await lockInventoryCatalog(tx, signal);
      await lockDirectory(tx, "read", signal);
      const staff = await currentInventoryActor(tx, who, signal);
      if (staff === null) return denied;
      const actor = { id: staff.id, access: await readWarehouseAccess(tx, staff, signal) };
      const workspace = await projectStocktakeWorkspace(tx, actor, query);
      return (await currentInventoryActor(tx, who, signal)) === null ? denied : workspace;
    });
  } catch (error) {
    return domainError(error);
  }
}
