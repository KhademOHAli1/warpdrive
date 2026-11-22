import { TRPCClientError } from "@trpc/client";
import { notFound } from "next/navigation";
import { AssetTagLandingFixture } from "@/features/assets/tags/AssetTagsFixture";
import { AssetTagLandingLive } from "@/features/assets/tags/AssetTagsLive";
import { isAssetTagToken } from "@/features/assets/tags/tagCodes";
import { inventoryFixturesEnabled } from "@/features/inventory/availability";
import { createContext } from "@/frontend/context";
import { coreClient } from "@/frontend/trpc";

export default async function EquipmentTagPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isAssetTagToken(token)) notFound();
  const { actor } = await createContext();
  const staff = actor?.isActive === true && !actor.projectsGuestOnly ? actor : null;
  const signInHref = `/login?returnTo=${encodeURIComponent(`/equipment-tag/${token}`)}`;
  const key = `${staff?.id ?? "public"}:${token}`;
  const actorId = staff?.id ?? null;
  if (inventoryFixturesEnabled()) {
    return (
      <AssetTagLandingFixture
        key={key}
        actorId={actorId}
        canManage={staff?.type === "admin"}
        token={token}
        signInHref={signInHref}
      />
    );
  }

  const contact =
    staff === null
      ? await coreClient()
          .assets.tags.publicContactHint.mutate({ token })
          .catch((error) => {
            if (!(error instanceof TRPCClientError)) throw error;
            return null;
          })
      : null;
  return (
    <AssetTagLandingLive
      key={key}
      actorId={actorId}
      token={token}
      signInHref={signInHref}
      proof={contact?.proof ?? null}
    />
  );
}
