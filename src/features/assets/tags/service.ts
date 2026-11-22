import type { Db } from "@/db/client";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { readTagWorkspace, unavailable, withTagActor } from "./nativeScope";

export { runAssetTagCommand } from "./nativeCommands";
export { resolveAssetTag, resolveAssetTagFromLabelScan } from "./nativeScans";
export { readAssetTagPublic, sendAssetTagContact } from "./ownerContact";

export function readAssetTagWorkspace(db: Db, who: NativeSessionRef, signal: AbortSignal) {
  return withTagActor(db, who, "read", signal, async (tx, _actor, sites) =>
    sites.length === 0
      ? unavailable
      : ({ ok: true, value: await readTagWorkspace(tx, sites) } as const),
  );
}
