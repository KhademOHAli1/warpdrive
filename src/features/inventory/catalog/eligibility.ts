import type { CatalogItemPolicy } from "./policy";

export function canHoldInventory(policy: CatalogItemPolicy | null): boolean {
  return policy?.active === true && !policy.isTemplate && policy.stockMode !== "virtual";
}
