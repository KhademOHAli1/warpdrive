import { notFound, redirect } from "next/navigation";
import { inventoryFixturesEnabled } from "@/features/inventory/availability";
import { LabelsFixture } from "@/features/physical-labels/LabelsFixture";
import { createContext } from "@/frontend/context";

export default async function OperationsLabelsPage() {
  const { actor, projectGuest } = await createContext();
  if (projectGuest !== null) notFound();
  if (actor === null) redirect("/login");
  if (!actor.isActive || actor.projectsGuestOnly || !inventoryFixturesEnabled()) notFound();
  return <LabelsFixture key={actor.id} actorId={actor.id} canManage={actor.type === "admin"} />;
}
