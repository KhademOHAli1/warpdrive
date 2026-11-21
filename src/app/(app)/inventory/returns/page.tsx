import { TRPCClientError } from "@trpc/client";
import { notFound, redirect } from "next/navigation";
import { inventoryFixturesEnabled } from "@/features/inventory/availability";
import { returnsQuery } from "@/features/inventory/returns/contracts";
import { ReturnsLive } from "@/features/inventory/returns/ui/ReturnsLive";
import { createContext, getBootstrap } from "@/frontend/context";
import { coreClient } from "@/frontend/trpc";

export default async function ReturnsPage({
  searchParams,
}: {
  searchParams: Promise<{
    siteId?: string | string[];
    caseId?: string | string[];
    shipmentId?: string | string[];
  }>;
}) {
  const { actor } = await createContext();
  if (!actor) redirect("/login");
  if (!actor.isActive || inventoryFixturesEnabled()) notFound();
  if ((await getBootstrap()).shell?.inventoryAvailable !== true) notFound();

  const { siteId, caseId, shipmentId } = await searchParams;
  const scope = returnsQuery.safeParse({ siteId, caseId, shipmentId });
  if (!scope.success) notFound();
  const initial = await coreClient()
    .inventory.returns.workspace.query(scope.data)
    .catch((error) => {
      if (!(error instanceof TRPCClientError)) throw error;
      return { ok: false, error: "unavailable" } as const;
    });
  return <ReturnsLive key={actor.id} actorId={actor.id} scope={scope.data} initial={initial} />;
}
