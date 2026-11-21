import type { AssetRecord, AssetsWorkspace } from "../../contracts";
import type { Kit, KitCheckout, KitCheckoutLine, KitError, KitMemberInput } from "../contracts";
import type { KitWords } from "./messages";

export const kitModeLabel = {
  individual: "individual",
  model: "model",
  returnable_pool: "returnable",
  consumable_pool: "consumable",
} as const satisfies Record<KitMemberInput["mode"], keyof KitWords>;

export function kitErrorText(error: KitError | "transport", words: KitWords): string {
  if (error === "unavailable") return words.denied;
  if (error === "held") return words.state;
  if (error === "quantity") return words.stock;
  return words[error];
}

export function availableKitAsset(workspace: AssetsWorkspace, asset: AssetRecord): boolean {
  return (
    asset.archivedAt === null &&
    workspace.custody?.holdings.some(({ assetId }) => assetId === asset.id) !== true
  );
}

export function kitRemaining(line: KitCheckoutLine): number {
  return line.quantity - line.returned - line.consumed;
}

export function activeKitCheckout(workspace: AssetsWorkspace, kitId: string) {
  return workspace.kits?.checkouts.find(
    ({ kitId: id, closedAt }) => id === kitId && closedAt === null,
  );
}

export function kitStatus(kit: Kit, active: KitCheckout | undefined): keyof KitWords {
  if (active !== undefined) {
    return active.lines.some(({ returned, consumed }) => returned + consumed > 0)
      ? "partial"
      : "out";
  }
  if (kit.lines.length === 0) return "draft";
  return kit.lines.every(({ packedQuantity, quantity }) => packedQuantity === quantity)
    ? "ready"
    : "unavailable";
}

export function kitsForAsset(workspace: AssetsWorkspace, assetId: string): Kit[] {
  if (workspace.kits === undefined) return [];
  const checkedOut = new Set(
    workspace.kits.checkouts
      .filter(
        ({ closedAt, lines }) =>
          closedAt === null &&
          lines.some((line) => line.assetId === assetId && kitRemaining(line) > 0),
      )
      .map(({ kitId }) => kitId),
  );
  return workspace.kits.records.filter(
    (kit) =>
      checkedOut.has(kit.id) ||
      kit.lines.some((line) => line.assetId === assetId && line.packedQuantity > 0),
  );
}

export function referenceAsset(record: AssetRecord): string {
  const identity = record.tracking === "individual" ? (record.serial ?? record.code) : record.code;
  return `${record.name} · ${identity}`;
}
