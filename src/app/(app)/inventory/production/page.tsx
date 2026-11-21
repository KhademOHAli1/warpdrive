import { TRPCClientError } from "@trpc/client";
import { notFound, redirect } from "next/navigation";
import { inventoryFixturesEnabled } from "@/features/inventory/availability";
import { productionQuery } from "@/features/inventory/production/contracts";
import { ProductionLive } from "@/features/inventory/production/ui/ProductionLive";
import { createContext, getBootstrap } from "@/frontend/context";
import { coreClient } from "@/frontend/trpc";

export default async function ProductionPage({
  searchParams,
}: {
  searchParams: Promise<{
    siteId?: string | string[];
    buildId?: string | string[];
    releaseId?: string | string[];
  }>;
}) {
  const { actor } = await createContext();
  if (!actor) redirect("/login");
  if (!actor.isActive || inventoryFixturesEnabled()) notFound();
  if ((await getBootstrap()).shell?.inventoryAvailable !== true) notFound();

  const { siteId, buildId, releaseId } = await searchParams;
  const scope = productionQuery.safeParse({ siteId, buildId, releaseId });
  if (!scope.success) notFound();
  const initial = await coreClient()
    .inventory.production.workspace.query(scope.data)
    .catch((error) => {
      if (!(error instanceof TRPCClientError)) throw error;
      return { ok: false, error: "unavailable" } as const;
    });

  return (
    <ProductionLive
      key={`${actor.id}:${scope.data.siteId ?? ""}:${scope.data.buildId ?? ""}:${scope.data.releaseId ?? ""}`}
      actorId={actor.id}
      initialScope={scope.data}
      initial={initial}
    />
  );
}
