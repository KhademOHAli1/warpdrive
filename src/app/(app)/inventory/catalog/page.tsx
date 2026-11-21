import { TRPCClientError } from "@trpc/client";
import { notFound, redirect } from "next/navigation";
import { inventoryFixturesEnabled } from "@/features/inventory/availability";
import { CatalogFixture } from "@/features/inventory/catalog/ui/CatalogFixture";
import { CatalogLive } from "@/features/inventory/catalog/ui/CatalogLive";
import { createContext, getBootstrap } from "@/frontend/context";
import { coreClient } from "@/frontend/trpc";

export default async function PartMasterPage() {
  const { actor } = await createContext();
  if (!actor) redirect("/login");
  if (!actor.isActive) notFound();
  if (inventoryFixturesEnabled()) {
    return <CatalogFixture key={actor.id} actorId={actor.id} canManage={actor.type === "admin"} />;
  }
  if ((await getBootstrap()).shell?.inventoryAvailable !== true) notFound();

  const result = await coreClient()
    .inventory.catalog.workspace.query({})
    .catch((error) => {
      if (!(error instanceof TRPCClientError)) throw error;
      return { ok: false, error: "unavailable" } as const;
    });
  return <CatalogLive actorId={actor.id} result={result} />;
}
