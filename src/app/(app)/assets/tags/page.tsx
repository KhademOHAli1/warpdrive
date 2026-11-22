import { notFound, redirect } from "next/navigation";
import { AssetTagsFixture } from "@/features/assets/tags/AssetTagsFixture";
import { inventoryFixturesEnabled } from "@/features/inventory/availability";
import { createContext } from "@/frontend/context";

export default async function AssetTagsPage() {
  const { actor, projectGuest } = await createContext();
  if (projectGuest !== null) notFound();
  if (actor === null) redirect("/login");
  if (!actor.isActive || actor.projectsGuestOnly || !inventoryFixturesEnabled()) notFound();
  return <AssetTagsFixture key={actor.id} canManage={actor.type === "admin"} />;
}
