import { notFound } from "next/navigation";
import { AssetTagLandingFixture } from "@/features/assets/tags/AssetTagsFixture";
import { isAssetTagToken } from "@/features/assets/tags/tagCodes";
import { inventoryFixturesEnabled } from "@/features/inventory/availability";
import { createContext } from "@/frontend/context";

export default async function EquipmentTagPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isAssetTagToken(token) || !inventoryFixturesEnabled()) notFound();
  const { actor } = await createContext();
  const staff = actor?.isActive === true && !actor.projectsGuestOnly ? actor : null;
  const signInHref = `/login?returnTo=${encodeURIComponent(`/equipment-tag/${token}`)}`;
  return (
    <AssetTagLandingFixture
      key={`${staff?.id ?? "public"}:${token}`}
      actorId={staff?.id ?? null}
      canManage={staff?.type === "admin"}
      token={token}
      signInHref={signInHref}
    />
  );
}
