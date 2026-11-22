import { TRPCClientError } from "@trpc/client";
import { notFound, redirect } from "next/navigation";
import { AssetTagsFixture } from "@/features/assets/tags/AssetTagsFixture";
import { AssetTagsLive } from "@/features/assets/tags/AssetTagsLive";
import { inventoryFixturesEnabled } from "@/features/inventory/availability";
import { createContext } from "@/frontend/context";
import { coreClient } from "@/frontend/trpc";

export default async function AssetTagsPage() {
  const { actor, projectGuest } = await createContext();
  if (projectGuest !== null) notFound();
  if (actor === null) redirect("/login");
  if (!actor.isActive || actor.projectsGuestOnly) notFound();
  if (inventoryFixturesEnabled())
    return <AssetTagsFixture key={actor.id} canManage={actor.type === "admin"} />;

  const result = await coreClient()
    .assets.tags.workspace.query()
    .catch((error) => {
      if (!(error instanceof TRPCClientError)) throw error;
      return { ok: false, error: "unavailable" } as const;
    });
  if (!result.ok || (result.value.sites.length === 0 && actor.type !== "admin")) notFound();
  return <AssetTagsLive key={actor.id} actorId={actor.id} initial={result.value} />;
}
