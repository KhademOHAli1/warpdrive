import { TRPCClientError } from "@trpc/client";
import { notFound, redirect } from "next/navigation";
import { inventoryFixturesEnabled } from "@/features/inventory/availability";
import { qualityQuery } from "@/features/inventory/quality/contracts";
import { QualityLive } from "@/features/inventory/quality/ui/QualityLive";
import { createContext, getBootstrap } from "@/frontend/context";
import { coreClient } from "@/frontend/trpc";

export default async function QualityPage({
  searchParams,
}: {
  searchParams: Promise<{ siteId?: string | string[]; targetId?: string | string[] }>;
}) {
  const { actor } = await createContext();
  if (!actor) redirect("/login");
  if (!actor.isActive || inventoryFixturesEnabled()) notFound();
  if ((await getBootstrap()).shell?.inventoryAvailable !== true) notFound();

  const { siteId, targetId } = await searchParams;
  const scope = qualityQuery.safeParse({ siteId, targetId });
  if (!scope.success) notFound();
  const initial = await coreClient()
    .inventory.quality.workspace.query(scope.data)
    .catch((error) => {
      if (!(error instanceof TRPCClientError)) throw error;
      return { ok: false, error: "unavailable" } as const;
    });

  return (
    <QualityLive
      key={`${actor.id}:${scope.data.siteId ?? ""}:${scope.data.targetId ?? ""}`}
      actorId={actor.id}
      initial={initial}
      scope={scope.data}
    />
  );
}
