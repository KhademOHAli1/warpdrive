import { TRPCClientError } from "@trpc/client";
import { notFound, redirect } from "next/navigation";
import { inventoryFixturesEnabled } from "@/features/inventory/availability";
import { stocktakeQuery } from "@/features/inventory/warehouse/stocktakes/contracts";
import { StocktakesLive } from "@/features/inventory/warehouse/stocktakes/ui/StocktakesLive";
import { createContext, getBootstrap } from "@/frontend/context";
import { coreClient } from "@/frontend/trpc";

export default async function StocktakesPage({
  searchParams,
}: {
  searchParams: Promise<{
    siteId?: string | string[];
    stocktakeId?: string | string[];
    valuationId?: string | string[];
  }>;
}) {
  const { actor } = await createContext();
  if (!actor) redirect("/login");
  if (!actor.isActive || inventoryFixturesEnabled()) notFound();
  if ((await getBootstrap()).shell?.inventoryAvailable !== true) notFound();

  const { siteId, stocktakeId, valuationId } = await searchParams;
  const scope = stocktakeQuery.safeParse({ siteId, stocktakeId, valuationId });
  if (!scope.success) notFound();
  const initial = await coreClient()
    .inventory.warehouse.stocktakes.workspace.query(scope.data)
    .catch((error) => {
      if (!(error instanceof TRPCClientError)) throw error;
      return { ok: false, error: "unavailable" } as const;
    });
  const key = `${actor.id}:${scope.data.siteId ?? ""}:${scope.data.stocktakeId ?? ""}:${scope.data.valuationId ?? ""}`;
  return <StocktakesLive key={key} actorId={actor.id} queryScope={scope.data} initial={initial} />;
}
