import { TRPCClientError } from "@trpc/client";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { AssetsFixture } from "@/features/assets/ui/AssetsFixture";
import { AssetsLive } from "@/features/assets/ui/AssetsLive";
import { inventoryFixturesEnabled } from "@/features/inventory/availability";
import { createContext } from "@/frontend/context";
import { coreClient } from "@/frontend/trpc";

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ assetId?: string | string[] }>;
}) {
  const { actor } = await createContext();
  if (actor === null) redirect("/login");
  if (!actor.isActive) notFound();
  if (inventoryFixturesEnabled()) {
    return <AssetsFixture key={actor.id} canManage={actor.type === "admin"} />;
  }
  const selected = z
    .uuid()
    .toLowerCase()
    .optional()
    .safeParse((await searchParams).assetId);
  if (!selected.success) notFound();
  const result = await coreClient()
    .assets.workspace.query()
    .catch((error) => {
      if (!(error instanceof TRPCClientError)) throw error;
      return { ok: false, error: "unavailable" } as const;
    });
  if (!result.ok || (result.value.sites.length === 0 && actor.type !== "admin")) notFound();
  const assetId = selected.data ?? null;
  if (assetId !== null && !result.value.records.some(({ id }) => id === assetId)) notFound();
  return (
    <AssetsLive
      key={`${actor.id}:${assetId ?? ""}`}
      actorId={actor.id}
      initial={result.value}
      initialAssetId={assetId}
    />
  );
}
