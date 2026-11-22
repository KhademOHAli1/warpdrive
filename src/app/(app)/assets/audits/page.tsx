import { TRPCClientError } from "@trpc/client";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { EquipmentAuditsFixture } from "@/features/assets/audits/EquipmentAuditsFixture";
import { EquipmentAuditsLive } from "@/features/assets/audits/EquipmentAuditsLive";
import { inventoryFixturesEnabled } from "@/features/inventory/availability";
import { createContext, getBootstrap } from "@/frontend/context";
import { coreClient } from "@/frontend/trpc";

const auditFocus = z.uuid().toLowerCase().optional();
const unauthorized = z.object({ code: z.literal("UNAUTHORIZED") });

export default async function EquipmentAuditsPage({
  searchParams,
}: {
  searchParams: Promise<{ auditId?: string | string[] }>;
}) {
  const { actor, projectGuest } = await createContext();
  if (projectGuest !== null) notFound();
  if (actor === null) redirect("/login");
  if (!actor.isActive || actor.projectsGuestOnly) notFound();
  const { auditId } = await searchParams;
  if (inventoryFixturesEnabled()) {
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
  const selected = auditFocus.safeParse(auditId);
  if (!selected.success) notFound();
  const { shell } = await getBootstrap();
  if (shell?.assetAuditsAvailable !== true) notFound();
  const result = await coreClient()
    .assets.audits.workspace.query()
    .catch((error) => {
      if (!(error instanceof TRPCClientError) || !unauthorized.safeParse(error.data).success)
        throw error;
      return { ok: false, error: "unavailable" } as const;
    });
  if (!result.ok || result.value.viewerId !== actor.id) notFound();
  if (selected.data !== undefined && !result.value.audits.some(({ id }) => id === selected.data))
    notFound();
  return (
    <EquipmentAuditsLive
      key={`${actor.id}:${selected.data ?? ""}`}
      actorId={actor.id}
      initial={result.value}
      initialAuditId={selected.data}
      canBrowseAssets={shell.assetsAvailable === true}
    />
  );
}
