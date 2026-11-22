import { notFound, redirect } from "next/navigation";
import { EquipmentAuditsFixture } from "@/features/assets/audits/EquipmentAuditsFixture";
import { inventoryFixturesEnabled } from "@/features/inventory/availability";
import { createContext } from "@/frontend/context";

export default async function EquipmentAuditsPage({
  searchParams,
}: {
  searchParams: Promise<{ auditId?: string | string[] }>;
}) {
  const { actor, projectGuest } = await createContext();
  if (projectGuest !== null) notFound();
  if (actor === null) redirect("/login");
  if (!actor.isActive || actor.projectsGuestOnly || !inventoryFixturesEnabled()) notFound();
  const { auditId } = await searchParams;
  return (
    <EquipmentAuditsFixture
      key={actor.id}
      actor={{ id: actor.id, name: actor.name }}
      manager={actor.type === "admin"}
      initialNow={new Date().toISOString()}
      initialAuditId={typeof auditId === "string" ? auditId : undefined}
    />
  );
}
