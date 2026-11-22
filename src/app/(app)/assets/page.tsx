import { TRPCClientError } from "@trpc/client";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { assetsFixture } from "@/features/assets/fixtures";
import { AssetsFixture } from "@/features/assets/ui/AssetsFixture";
import { AssetsLive } from "@/features/assets/ui/AssetsLive";
import { inventoryFixturesEnabled } from "@/features/inventory/availability";
import { createContext, getBootstrap } from "@/frontend/context";
import { coreClient } from "@/frontend/trpc";

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ assetId?: string | string[] }>;
}) {
  const { actor } = await createContext();
  if (actor === null) redirect("/login");
  if (!actor.isActive) notFound();
  const selected = z
    .uuid()
    .toLowerCase()
    .optional()
    .safeParse((await searchParams).assetId);
  if (!selected.success) notFound();
  const assetId = selected.data ?? null;
  if (inventoryFixturesEnabled()) {
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
  const { shell } = await getBootstrap();
  return (
    <AssetsLive
      key={`${actor.id}:${assetId ?? ""}`}
      actorId={actor.id}
      initial={result.value}
      initialAssetId={assetId}
      bookingsAvailable={shell?.bookingsAvailable === true}
      physicalLabelsAvailable={shell?.physicalLabelsAvailable === true}
    />
  );
}
