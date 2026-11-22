import { TRPCClientError } from "@trpc/client";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { assetsFixture } from "@/features/assets/fixtures";
import { AssetsFixture } from "@/features/assets/ui/AssetsFixture";
import { AssetsLive } from "@/features/assets/ui/AssetsLive";
import { inventoryFixturesEnabled } from "@/features/inventory/availability";
import { createContext, getBootstrap } from "@/frontend/context";
import { coreClient } from "@/frontend/trpc";

const focusId = z.uuid().toLowerCase().optional();
const assetFocus = z
  .object({ assetId: focusId, kitId: focusId })
  .refine(({ assetId, kitId }) => assetId === undefined || kitId === undefined);

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ assetId?: string | string[]; kitId?: string | string[] }>;
}) {
  const { actor } = await createContext();
  if (actor === null) redirect("/login");
  if (!actor.isActive) notFound();
  const selected = assetFocus.safeParse(await searchParams);
  if (!selected.success) notFound();
  const { assetId = null, kitId = null } = selected.data;
  if (inventoryFixturesEnabled()) {
    if (kitId !== null) notFound();
    const canManage = actor.type === "admin";
    if (assetId !== null && !assetsFixture(canManage).records.some(({ id }) => id === assetId))
      notFound();
    return (
      <AssetsFixture
        key={`${actor.id}:${assetId ?? ""}`}
        canManage={canManage}
        initialAssetId={assetId}
      />
    );
  }
  const result = await coreClient()
    .assets.workspace.query()
    .catch((error) => {
      if (!(error instanceof TRPCClientError)) throw error;
      return { ok: false, error: "unavailable" } as const;
    });
  if (!result.ok || (result.value.sites.length === 0 && actor.type !== "admin")) notFound();
  if (assetId !== null && !result.value.records.some(({ id }) => id === assetId)) notFound();
  if (kitId !== null && result.value.kits?.records.some(({ id }) => id === kitId) !== true)
    notFound();
  const { shell } = await getBootstrap();
  return (
    <AssetsLive
      key={`${actor.id}:${assetId ?? ""}:${kitId ?? ""}`}
      actorId={actor.id}
      initial={result.value}
      initialAssetId={assetId}
      initialKitId={kitId}
      bookingsAvailable={shell?.bookingsAvailable === true}
      physicalLabelsAvailable={shell?.physicalLabelsAvailable === true}
      assetTagsAvailable={shell?.assetTagsAvailable === true}
      auditsAvailable={shell?.assetAuditsAvailable === true}
    />
  );
}
