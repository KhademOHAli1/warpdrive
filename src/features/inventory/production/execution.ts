import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { hasPendingBuildInspection } from "../quality/gates";
import { lockInventoryStock } from "../stock";
import {
  autoAllocateProductionMaterial,
  changeBuildAllocation,
  readBuildMaterials,
  releaseAllBuildAllocations,
} from "./allocations";
import { inventoryProductionBuilds, type ProductionBuildRow } from "./buildSchema";
import type { ExistingProductionCommand, ProductionStatus } from "./contracts";
import { failProduction } from "./failure";
import {
  cancelOpenProductionBatches,
  cancelProductionBatch,
  finalizeProductionBatch,
  reverseProductionOutput,
  startProductionBatch,
} from "./outputs";
import { requireStorageBin } from "./stock";

const openBuild = ["planned", "issued", "on_hold"] as const;
const allocating = ["planned", "issued"] as const;

const admittedStates: Record<ExistingProductionCommand["type"], readonly ProductionStatus[]> = {
  schedule: openBuild,
  issue: ["planned"],
  hold: ["issued"],
  resume: ["on_hold"],
  allocate: allocating,
  deallocate: openBuild,
  autoAllocate: allocating,
  startBatch: ["issued"],
  finalizeBatch: ["issued"],
  cancelBatch: ["issued", "on_hold"],
  reverseOutput: ["issued", "on_hold", "closed"],
  cancelBuild: openBuild,
};

function setStatus(tx: Db, buildId: string, status: ProductionStatus) {
  return tx
    .update(inventoryProductionBuilds)
    .set({ status })
    .where(eq(inventoryProductionBuilds.id, buildId));
}

async function autoAllocateBuild(
  tx: Db,
  actorId: string,
  requestId: string,
  build: ProductionBuildRow,
  signal: AbortSignal,
) {
  const materials = await readBuildMaterials(tx, build.id);
  // Acquire the whole set in canonical item order before any individual reserve.
  await lockInventoryStock(
    tx,
    materials.map(({ itemId }) => itemId),
  );
  for (const material of materials) {
    signal.throwIfAborted();
    await autoAllocateProductionMaterial(tx, actorId, requestId, build, material);
  }
}

async function cancelBuild(
  tx: Db,
  actorId: string,
  build: ProductionBuildRow,
  { reason, requestId }: { reason: string; requestId: string },
) {
  if (await hasPendingBuildInspection(tx, build.id)) failProduction("state");
  const materials = await readBuildMaterials(tx, build.id);
  const stock = await lockInventoryStock(
    tx,
    materials.map(({ itemId }) => itemId),
  );
  await releaseAllBuildAllocations(tx, actorId, requestId, build, stock);
  await cancelOpenProductionBatches(tx, actorId, build, reason);
  await setStatus(tx, build.id, "cancelled");
}

/** The command transaction has already locked and admitted this exact build. */
export async function executeBuildOperation(
  tx: Db,
  actorId: string,
  build: ProductionBuildRow,
  command: ExistingProductionCommand,
  signal: AbortSignal,
): Promise<void> {
  if (!admittedStates[command.type].includes(build.status)) failProduction("state");
  signal.throwIfAborted();
  switch (command.type) {
    case "schedule":
      await tx
        .update(inventoryProductionBuilds)
        .set({ priority: command.priority, dueDate: command.dueDate })
        .where(eq(inventoryProductionBuilds.id, build.id));
      return;
    case "issue":
    case "resume":
      await requireStorageBin(tx, build.siteId, build.locationId);
      await setStatus(tx, build.id, "issued");
      return;
    case "hold":
      await setStatus(tx, build.id, "on_hold");
      return;
    case "allocate":
    case "deallocate":
      await changeBuildAllocation(tx, actorId, build, command);
      return;
    case "autoAllocate":
      await autoAllocateBuild(tx, actorId, command.requestId, build, signal);
      return;
    case "startBatch":
      await startProductionBatch(tx, actorId, build, command.quantity);
      return;
    case "cancelBatch":
      await cancelProductionBatch(tx, actorId, build, command);
      return;
    case "finalizeBatch":
      await finalizeProductionBatch(tx, actorId, build, command, signal);
      return;
    case "reverseOutput":
      await reverseProductionOutput(tx, actorId, build, command);
      return;
    case "cancelBuild":
      await cancelBuild(tx, actorId, build, command);
      return;
  }
}
