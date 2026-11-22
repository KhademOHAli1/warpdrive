import { TRPCClientError } from "@trpc/client";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { inventoryFixturesEnabled } from "@/features/inventory/availability";
import { inventoryFixture } from "@/features/inventory/fixtures";
import { InventoryFixture } from "@/features/inventory/InventoryFixture";
import { InventoryLive } from "@/features/inventory/InventoryLive";
import { createContext, type FrontendContext, getBootstrap } from "@/frontend/context";
import { coreClient } from "@/frontend/trpc";

function releaseFixtureActor(actor: NonNullable<FrontendContext["actor"]>) {
  const canView = actor.isActive && !actor.projectsGuestOnly;
  const canManage = canView && actor.type === "admin";
  return {
    id: actor.id,
    name: actor.name,
    canView,
    canPropose: canManage,
    canDecide: canManage,
    visibleSites: canManage ? ["berlin", "dresden"] : [],
    dispositionSites: canManage ? ["berlin"] : [],
  };
}

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
  const selected = z.uuid().toLowerCase().optional().safeParse(itemId);
  if (!selected.success) notFound();
  const view = parsed.data ?? "catalog";
  const openReleases = tab === "releases" && parsed.data === undefined;
  if (inventoryFixturesEnabled()) {
    const initial = inventoryFixture(parsed.data);
    const engineeringActor = releaseFixtureActor(actor);
    if (selected.data !== undefined && !initial.items.some(({ id }) => id === selected.data))
      notFound();
    return (
      <InventoryFixture
        key={`${actor.id}:${openReleases ? "catalog-releases" : view}:${selected.data ?? ""}`}
        initial={initial}
        openReleases={openReleases}
        initialItemId={selected.data}
        canEditIntake={engineeringActor.canPropose}
        engineeringActor={engineeringActor}
      />
    );
  }
  const { shell } = await getBootstrap();
  if (shell?.inventoryAvailable !== true) notFound();

  const result = await coreClient()
    .inventory.workspace.query({ dealId: parsed.data ?? null })
    .catch((error) => {
      if (!(error instanceof TRPCClientError)) throw error;
      return { ok: false, error: "Inventory could not be loaded." } as const;
    });
  return (
    <InventoryLive
      key={`${actor.id}:${view}:${selected.data ?? ""}:${openReleases}`}
      actorId={actor.id}
      result={result}
      openReleases={openReleases}
      initialItemId={selected.data}
      physicalLabelsAvailable={shell.physicalLabelsAvailable === true}
    />
  );
}
