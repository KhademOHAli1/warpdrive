import type { KitWorkspace } from "./contracts";

export function kitAssetUsage(kits: KitWorkspace | undefined, assetId: string) {
  const packed = (kits?.records ?? [])
    .flatMap(({ lines }) => lines)
    .filter((line) => line.assetId === assetId)
    .reduce((quantity, line) => quantity + line.packedQuantity, 0);
  const held = (kits?.checkouts ?? [])
    .filter(({ closedAt }) => closedAt === null)
    .flatMap(({ lines }) => lines)
    .filter((line) => line.assetId === assetId)
    .reduce((quantity, line) => quantity + line.quantity - line.returned - line.consumed, 0);
  return { packed, held };
}

export function kitUsesAsset(kits: KitWorkspace | undefined, assetId: string): boolean {
  const { packed, held } = kitAssetUsage(kits, assetId);
  return packed > 0 || held > 0;
}
