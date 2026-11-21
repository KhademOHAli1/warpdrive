import type { Db } from "@/db/client";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { lockDirectory } from "@/features/locations/service";
import { currentInventoryActor } from "../../access";
import { lockInventoryCatalog } from "../../catalog/policy";
import { readWarehouseAccess, type WarehouseAccess } from "../access";
import { projectMovementHistory } from "./historyProjection";
import type {
  WarehouseMovementHistoryQuery,
  WarehouseMovementHistoryResult,
  WarehouseOperationsResult,
  WarehouseTransfersQuery,
  WarehouseTransfersResult,
} from "./readContracts";
import { projectTransfers } from "./transferProjection";

function readWithWarehouseScope<T>(
  db: Db,
  who: NativeSessionRef,
  signal: AbortSignal,
  project: (tx: Db, access: WarehouseAccess) => Promise<T>,
): Promise<WarehouseOperationsResult<T>> {
  return withCurrentAuthority(db, "read", signal, async (tx) => {
    await lockInventoryCatalog(tx, signal);
    await lockDirectory(tx, "read", signal);
    const actor = await currentInventoryActor(tx, who, signal);
    if (actor === null) return { ok: false, error: "unavailable" };
    const access = await readWarehouseAccess(tx, actor, signal);
    const value = await project(tx, access);
    if ((await currentInventoryActor(tx, who, signal)) === null) {
      return { ok: false, error: "unavailable" };
    }
    return { ok: true, value };
  });
}

export function readWarehouseMovementHistory(
  db: Db,
  who: NativeSessionRef,
  query: WarehouseMovementHistoryQuery,
  signal: AbortSignal,
): Promise<WarehouseMovementHistoryResult> {
  return readWithWarehouseScope(db, who, signal, (tx, access) =>
    projectMovementHistory(tx, access, query),
  );
}

export function readWarehouseTransfers(
  db: Db,
  who: NativeSessionRef,
  query: WarehouseTransfersQuery,
  signal: AbortSignal,
): Promise<WarehouseTransfersResult> {
  return readWithWarehouseScope(db, who, signal, (tx, access) =>
    projectTransfers(tx, access, query),
  );
}
