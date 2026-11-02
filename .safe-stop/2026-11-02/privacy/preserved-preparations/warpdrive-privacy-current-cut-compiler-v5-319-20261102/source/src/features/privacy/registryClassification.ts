import { coreClassifications } from "./registryClassificationsCore";
import { operationalClassifications } from "./registryClassificationsOperational";
import type { InventoryClassification, LifecycleOperation, RegistryEntry } from "./registryTypes";

const NEXT_TASK: Record<LifecycleOperation, string> = {
  discovery: "DPL-07",
  export: "DPL-08",
  rectification: "DPL-20",
  restriction: "DPL-19",
  erasure: "DPL-15",
  retention: "DPL-21",
};

export function classifyInventory(
  ids: string[],
  classification: InventoryClassification,
): RegistryEntry {
  const capabilities = Object.fromEntries(
    Object.entries(NEXT_TASK).map(([operation, task]) => [
      operation,
      {
        status: "unsupported" as const,
        reason:
          "Inventory classification is source evidence only. A reviewed, tested lifecycle adapter is required before execution.",
        task: operation === "erasure" ? classification.erasureTask : task,
      },
    ]),
  ) as RegistryEntry["capabilities"];
  return {
    ids,
    ...classification,
    proof:
      "Source inventory only. No physical erasure, remote receipt or installation acceptance is established.",
    capabilities,
  };
}

export const classifications = { ...coreClassifications, ...operationalClassifications };
