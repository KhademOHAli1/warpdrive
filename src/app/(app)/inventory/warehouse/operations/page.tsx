import { TRPCClientError } from "@trpc/client";
import { notFound, redirect } from "next/navigation";
import { inventoryFixturesEnabled } from "@/features/inventory/availability";
import { WarehouseOperationsLive } from "@/features/inventory/warehouse/operations/ui/WarehouseOperationsLive";
import { createContext, getBootstrap } from "@/frontend/context";
import { coreClient } from "@/frontend/trpc";

export default async function WarehouseOperationsPage() {
  const { actor } = await createContext();
  if (!actor) redirect("/login");
  if (!actor.isActive || inventoryFixturesEnabled()) notFound();
  if ((await getBootstrap()).shell?.inventoryAvailable !== true) notFound();

  const result = await coreClient()
    .inventory.warehouse.workspace.query({ showEmpty: true })
    .catch((error) => {
      if (!(error instanceof TRPCClientError)) throw error;
      return { ok: false, error: "unavailable" } as const;
    });
  return <WarehouseOperationsLive key={actor.id} actorId={actor.id} initial={result} />;
}
