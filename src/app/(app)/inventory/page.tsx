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
  searchParams: Promise<{
    dealId?: string | string[];
    tab?: string | string[];
    itemId?: string | string[];
  }>;
}) {
  const { actor } = await createContext();
  if (!actor) redirect("/login");
  const { dealId, tab, itemId } = await searchParams;
  const parsed = z.uuid().toLowerCase().optional().safeParse(dealId);
  if (!parsed.success) notFound();
  const view = parsed.data ?? "catalog";
  const openReleases = tab === "releases" && parsed.data === undefined;
  if (inventoryFixturesEnabled()) {
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
  const selected = z.uuid().toLowerCase().optional().safeParse(itemId);
  if (!selected.success) notFound();
  return (
    <InventoryLive
      key={`${actor.id}:${view}:${selected.data ?? ""}:${openReleases}`}
      actorId={actor.id}
      result={result}
      openReleases={openReleases}
      initialItemId={selected.data}
    />
  );
}
