import type { Db } from "@/db/client";
import { persistCustodyChanges } from "../../custody/repository";
import { persistKitChanges } from "../../kits/repository";
import { persistAssetChanges } from "../../repository";
import type { HandoverPhysicalEffect } from "./transitions";

function appended<T extends { id: string }>(before: readonly T[], after: readonly T[]) {
  const persisted = new Set(before.map(({ id }) => id));
  return after.filter(({ id }) => !persisted.has(id));
}

/** The caller holds the Asset write lock and commits the effects with the booking receipt. */
export async function persistPhysicalHandoverEffects(
  tx: Db,
  effects: readonly HandoverPhysicalEffect[],
  actorId: string,
) {
  // An Asset event must match the current version before the next step advances it again.
  for (const effect of effects) {
    const { before, after } = effect;
    switch (effect.kind) {
      case "asset":
        await persistAssetChanges(tx, before, after, actorId);
        break;
      case "custody":
        await persistCustodyChanges(
          tx,
          before,
          {
            ...after,
            custody: {
              ...after.custody,
              events: appended(before.custody.events, after.custody.events),
              notes: appended(before.custody.notes, after.custody.notes),
            },
          },
          actorId,
        );
        break;
      case "kit":
        await persistKitChanges(
          tx,
          before,
          {
            ...after,
            kits: {
              ...after.kits,
              returns: appended(before.kits.returns, after.kits.returns),
              history: appended(before.kits.history, after.kits.history),
            },
          },
          effect.kitId,
          actorId,
        );
        break;
    }
  }
}
