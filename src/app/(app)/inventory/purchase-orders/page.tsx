import { TRPCClientError } from "@trpc/client";
import { notFound, redirect } from "next/navigation";
import { inventoryFixturesEnabled } from "@/features/inventory/availability";
import { purchasingQuery } from "@/features/inventory/purchasing/contracts";
import { PurchasingLive } from "@/features/inventory/purchasing/ui/PurchasingLive";
import { createContext, getBootstrap } from "@/frontend/context";
import { coreClient } from "@/frontend/trpc";

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ siteId?: string | string[]; orderId?: string | string[] }>;
}) {
  const { actor } = await createContext();
  if (!actor) redirect("/login");
  if (!actor.isActive || inventoryFixturesEnabled()) notFound();
  if ((await getBootstrap()).shell?.inventoryAvailable !== true) notFound();

  const { siteId, orderId } = await searchParams;
  const scope = purchasingQuery.safeParse({ siteId, orderId });
  if (!scope.success) notFound();
  const result = await coreClient()
    .inventory.purchasing.workspace.query(scope.data)
    .catch((error) => {
      if (!(error instanceof TRPCClientError)) throw error;
      return { ok: false, error: "unavailable" } as const;
    });
  const key = `${actor.id}:${scope.data.siteId ?? ""}:${scope.data.orderId ?? ""}`;
  return (
    <PurchasingLive key={key} actorId={actor.id} initialQuery={scope.data} initialResult={result} />
  );
}
