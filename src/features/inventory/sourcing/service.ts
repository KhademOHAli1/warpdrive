import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { lockDirectory } from "@/features/locations/service";
import { currentOperationsActor } from "@/features/operations-access/scope";
import { lockInventoryCatalog } from "../catalog/policy";
import { inventoryCommandReceipts } from "../schema";
import { prepareSourcingChange } from "./changes";
import { type SourcingCommand, type SourcingCommandResult, sourcingCommand } from "./contracts";
import {
  failSourcing,
  lockSourcingRecords,
  readSourcingParts,
  readSourcingSites,
  SourcingFailure,
} from "./scope";

export { readSourcingWorkspace } from "./reads";

async function claimSourcingReceipt(tx: Db, actorId: string, command: SourcingCommand) {
  const fingerprint = createHash("sha256")
    .update("inventory-sourcing-v1\0")
    .update(JSON.stringify(command))
    .digest("hex");
  const table = inventoryCommandReceipts;
  const [claimed] = await tx
    .insert(table)
    .values({ actorId, requestId: command.requestId, fingerprint })
    .onConflictDoNothing()
    .returning({ requestId: table.requestId });
  if (claimed !== undefined) return true;
  const [previous] = await tx
    .select({ fingerprint: table.fingerprint })
    .from(table)
    .where(and(eq(table.actorId, actorId), eq(table.requestId, command.requestId)));
  if (previous?.fingerprint !== fingerprint) failSourcing("conflict");
  return false;
}

const uniqueSourcingConstraints = new Set([
  "inventory_manufacturer_parts_number_key",
  "inventory_supplier_offers_number_key",
]);

function isSourcingNumberConflict(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 4 && typeof current === "object" && current !== null; depth++) {
    if ("code" in current && current.code === "23505" && "constraint" in current) {
      return (
        typeof current.constraint === "string" && uniqueSourcingConstraints.has(current.constraint)
      );
    }
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

export async function runSourcingCommand(
  db: Db,
  who: NativeSessionRef,
  raw: unknown,
  signal: AbortSignal,
): Promise<SourcingCommandResult> {
  const parsed = sourcingCommand.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const command = parsed.data;
  const sourcingIdentity = command.type === "saveManufacturer" || command.type === "saveOffer";
  if (sourcingIdentity && (command.id === null) !== (command.expectedVersion === null)) {
    return { ok: false, error: "invalid" };
  }

  try {
    return await withCurrentAuthority(db, "read", signal, async (tx) => {
      await lockInventoryCatalog(tx, signal);
      await lockDirectory(tx, "read", signal);
      const actor = await currentOperationsActor(tx, who, signal);
      if (actor === null) failSourcing("unavailable");
      const site = (await readSourcingSites(tx, actor)).find(({ id }) => id === command.siteId);
      const canEdit = sourcingIdentity ? site?.canBuy : site?.canEditCosts;
      if (canEdit !== true) failSourcing("unavailable");
      const part = (await readSourcingParts(tx, actor)).find(({ id }) => id === command.itemId);
      if (part === undefined) failSourcing("unavailable");

      await lockSourcingRecords(tx, command.siteId, command.itemId, "write", signal);
      const apply = await prepareSourcingChange(tx, actor, part, command);
      if (await claimSourcingReceipt(tx, actor.id, command)) await apply();
      if ((await currentOperationsActor(tx, who, signal)) === null) failSourcing("unavailable");
      return { ok: true };
    });
  } catch (error) {
    if (error instanceof SourcingFailure) return { ok: false, error: error.code };
    if (isSourcingNumberConflict(error)) return { ok: false, error: "conflict" };
    throw error;
  }
}
