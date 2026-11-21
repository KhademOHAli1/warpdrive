import { TRPCClientError } from "@trpc/client";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { inventoryFixturesEnabled } from "@/features/inventory/availability";
import { salesQuery } from "@/features/inventory/sales/contracts";
import { SalesLive } from "@/features/inventory/sales/ui/SalesLive";
import { createContext, getBootstrap } from "@/frontend/context";
import { coreClient } from "@/frontend/trpc";

const viewQuery = z.object({
  view: z.enum(["list", "calendar"]).optional(),
  day: z.iso.date().optional(),
});

export default async function SalesOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{
    siteId?: string | string[];
    dealId?: string | string[];
    orderId?: string | string[];
    view?: string | string[];
    day?: string | string[];
  }>;
}) {
  const { actor } = await createContext();
  if (!actor) redirect("/login");
  if (!actor.isActive || inventoryFixturesEnabled()) notFound();
  if ((await getBootstrap()).shell?.inventoryAvailable !== true) notFound();

  const { siteId, dealId, orderId, view, day } = await searchParams;
  const scope = salesQuery.safeParse({ siteId, dealId, orderId });
  const layout = viewQuery.safeParse({ view, day });
  if (!scope.success || !layout.success) notFound();
  const initial = await coreClient()
    .inventory.sales.workspace.query(scope.data)
    .catch((error) => {
      if (!(error instanceof TRPCClientError)) throw error;
      return { ok: false, error: "unavailable" } as const;
    });
  return (
    <SalesLive
      key={actor.id}
      actorId={actor.id}
      scope={scope.data}
      initial={initial}
      view={layout.data.view ?? "list"}
      day={layout.data.day}
    />
  );
}
