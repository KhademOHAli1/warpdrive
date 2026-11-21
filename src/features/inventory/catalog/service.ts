import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { currentInventoryActor } from "../access";
import { applyCatalogCommand, CatalogCommandFailure, failCatalog } from "./changes";
import {
  type CatalogCommand,
  type CatalogQuery,
  type CatalogResult,
  catalogCommand,
} from "./contracts";
import { lockInventoryCatalog } from "./policy";
import { projectCatalogWorkspace, readCatalogRecords } from "./reads";
import { inventoryCatalogReceipts } from "./schema";

export function readCatalogWorkspace(
  db: Db,
  who: NativeSessionRef,
  query: CatalogQuery,
  signal: AbortSignal,
): Promise<CatalogResult> {
  return withCurrentAuthority(db, "read", signal, async (tx) => {
    await lockInventoryCatalog(tx, signal);
    const actor = await currentInventoryActor(tx, who, signal);
    if (actor === null) return { ok: false, error: "unavailable" };
    const value = await projectCatalogWorkspace(tx, query, actor.type === "admin");
    if ((await currentInventoryActor(tx, who, signal)) === null) {
      return { ok: false, error: "unavailable" };
    }
    return { ok: true, value };
  });
}

async function changeOrReplay(tx: Db, actorId: string, command: CatalogCommand) {
  const fingerprint = createHash("sha256").update(JSON.stringify(command)).digest("hex");
  const [receipt] = await tx
    .select()
    .from(inventoryCatalogReceipts)
    .where(
      and(
        eq(inventoryCatalogReceipts.actorId, actorId),
        eq(inventoryCatalogReceipts.requestId, command.requestId),
      ),
    );
  if (receipt !== undefined) {
    if (receipt.fingerprint !== fingerprint) failCatalog("conflict");
    return receipt.focusId;
  }
  const focusId = await applyCatalogCommand(tx, await readCatalogRecords(tx), command);
  await tx
    .insert(inventoryCatalogReceipts)
    .values({ actorId, requestId: command.requestId, fingerprint, focusId });
  return focusId;
}

export async function runCatalogCommand(
  db: Db,
  who: NativeSessionRef,
  raw: unknown,
  signal: AbortSignal,
): Promise<CatalogResult> {
  const command = catalogCommand.safeParse(raw);
  if (!command.success) return { ok: false, error: "invalid" };
  try {
    return await withCurrentAuthority(db, "read", signal, async (tx) => {
      await lockInventoryCatalog(tx, signal, "write");
      const actor = await currentInventoryActor(tx, who, signal);
      if (actor?.type !== "admin") failCatalog("unavailable");
      const focusId = await changeOrReplay(tx, actor.id, command.data);
      const value = await projectCatalogWorkspace(tx, {}, true);
      if ((await currentInventoryActor(tx, who, signal))?.type !== "admin")
        failCatalog("unavailable");
      return { ok: true, value, focusId };
    });
  } catch (error) {
    if (error instanceof CatalogCommandFailure) return { ok: false, error: error.code };
    throw error;
  }
}
