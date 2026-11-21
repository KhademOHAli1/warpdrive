import { TRPCClientError } from "@trpc/client";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { inventoryFixturesEnabled } from "@/features/inventory/availability";
import { inventoryFixture } from "@/features/inventory/fixtures";
import { InventoryFixture } from "@/features/inventory/InventoryFixture";
import { InventoryLive } from "@/features/inventory/InventoryLive";
import { createContext, getBootstrap } from "@/frontend/context";
import { coreClient } from "@/frontend/trpc";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ dealId?: string | string[]; tab?: string | string[] }>;
}) {
  const { actor } = await createContext();
  if (!actor) redirect("/login");
  const { dealId, tab } = await searchParams;
  const parsed = z.uuid().toLowerCase().optional().safeParse(dealId);
  if (!parsed.success) notFound();
  const view = parsed.data ?? "catalog";
  if (inventoryFixturesEnabled()) {
    const openReleases = tab === "releases" && parsed.data === undefined;
    return (
      <InventoryFixture
        key={openReleases ? "catalog-releases" : view}
        initial={inventoryFixture(parsed.data)}
        openReleases={openReleases}
      />
    );
  }
  if ((await getBootstrap()).shell?.inventoryAvailable !== true) notFound();

  const result = await coreClient()
    .inventory.workspace.query({ dealId: parsed.data ?? null })
    .catch((error) => {
      if (!(error instanceof TRPCClientError)) throw error;
      return { ok: false, error: "Inventory could not be loaded." } as const;
    });
  return <InventoryLive key={`${actor.id}:${view}`} actorId={actor.id} result={result} />;
}
