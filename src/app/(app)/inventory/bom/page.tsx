import { TRPCClientError } from "@trpc/client";
import { notFound, redirect } from "next/navigation";
import { inventoryFixturesEnabled } from "@/features/inventory/availability";
import { bomPlanningQuery } from "@/features/inventory/bom/contracts";
import { BomPlanner } from "@/features/inventory/bom/ui/BomPlanner";
import { createContext, getBootstrap } from "@/frontend/context";
import { coreClient } from "@/frontend/trpc";

export default async function BomPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { actor } = await createContext();
  if (!actor) redirect("/login");
  if (!actor.isActive || inventoryFixturesEnabled()) notFound();
  if ((await getBootstrap()).shell?.inventoryAvailable !== true) notFound();

  const { releaseId, partId, siteId, compareReleaseId } = await searchParams;
  const scope = bomPlanningQuery.safeParse({ releaseId, partId, siteId, compareReleaseId });
  if (!scope.success) notFound();
  const initial = await coreClient()
    .inventory.bom.workspace.query(scope.data)
    .catch((error) => {
      if (!(error instanceof TRPCClientError)) throw error;
      return { ok: false, error: "unavailable" } as const;
    });
  const key = `${actor.id}:${JSON.stringify(scope.data)}`;
  return <BomPlanner key={key} initialScope={scope.data} initial={initial} />;
}
