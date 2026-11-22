import { TRPCClientError } from "@trpc/client";
import { notFound, redirect } from "next/navigation";
import { inventoryFixturesEnabled } from "@/features/inventory/availability";
import { LabelsFixture } from "@/features/physical-labels/LabelsFixture";
import { LabelsLive } from "@/features/physical-labels/LabelsLive";
import { createContext } from "@/frontend/context";
import { coreClient } from "@/frontend/trpc";

export default async function OperationsLabelsPage() {
  const { actor, projectGuest } = await createContext();
  if (projectGuest !== null) notFound();
  if (actor === null) redirect("/login");
  if (!actor.isActive || actor.projectsGuestOnly) notFound();
  if (inventoryFixturesEnabled())
    return <LabelsFixture key={actor.id} actorId={actor.id} canManage={actor.type === "admin"} />;

  const result = await coreClient()
    .physicalLabels.workspace.query()
    .catch((error) => {
      if (!(error instanceof TRPCClientError)) throw error;
      return { ok: false, error: "unavailable" } as const;
    });
  if (!result.ok) notFound();
  return <LabelsLive key={actor.id} actorId={actor.id} initial={result.value} />;
}
