import { TRPCClientError } from "@trpc/client";
import { notFound, redirect } from "next/navigation";
import { inventoryFixturesEnabled } from "@/features/inventory/availability";
import { SourcingLive } from "@/features/inventory/sourcing/ui/SourcingLive";
import { createContext, getBootstrap } from "@/frontend/context";
import { coreClient } from "@/frontend/trpc";

export default async function InventorySourcingPage() {
  const { actor } = await createContext();
  if (!actor) redirect("/login");
  if (!actor.isActive || inventoryFixturesEnabled()) notFound();
  if ((await getBootstrap()).shell?.inventoryAvailable !== true) notFound();

  const result = await coreClient()
    .inventory.sourcing.workspace.query({})
    .catch((error) => {
      if (!(error instanceof TRPCClientError)) throw error;
      return { ok: false, error: "unavailable" } as const;
    });
  return <SourcingLive key={actor.id} actorId={actor.id} initial={result} />;
}
