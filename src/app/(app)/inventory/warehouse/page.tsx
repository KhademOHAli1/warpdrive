import { TRPCClientError } from "@trpc/client";
import { notFound, redirect } from "next/navigation";
import { inventoryFixturesEnabled } from "@/features/inventory/availability";
import { WarehouseFixture } from "@/features/inventory/warehouse/ui/WarehouseFixture";
import { WarehouseLive } from "@/features/inventory/warehouse/ui/WarehouseLive";
import { createContext, getBootstrap } from "@/frontend/context";
import { coreClient } from "@/frontend/trpc";

export default async function WarehouseStockPage() {
  const { actor } = await createContext();
  if (!actor) redirect("/login");
  if (!actor.isActive) notFound();
  if (inventoryFixturesEnabled()) {
    return <WarehouseFixture key={actor.id} canManage={actor.type === "admin"} />;
  }
  if ((await getBootstrap()).shell?.inventoryAvailable !== true) notFound();
  const result = await coreClient()
    .inventory.warehouse.workspace.query({ showEmpty: true })
    .catch((error) => {
      if (!(error instanceof TRPCClientError)) throw error;
      return { ok: false, error: "unavailable" } as const;
    });
  return <WarehouseLive actorId={actor.id} result={result} />;
}
