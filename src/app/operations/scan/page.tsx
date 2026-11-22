import { notFound, redirect } from "next/navigation";
import { inventoryFixturesEnabled } from "@/features/inventory/availability";
import { isInternalLabelCode, physicalLabelScanPath } from "@/features/physical-labels/formats";
import { LabelScannerFixture } from "@/features/physical-labels/LabelScannerFixture";
import { createContext } from "@/frontend/context";

export default async function OperationsScanPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { actor, projectGuest } = await createContext();
  if (projectGuest !== null) notFound();
  const { code } = await searchParams;
  const initialCode = typeof code === "string" && isInternalLabelCode(code) ? code : undefined;
  if (actor === null) {
    const destination =
      initialCode === undefined
        ? physicalLabelScanPath
        : `${physicalLabelScanPath}?code=${encodeURIComponent(initialCode)}`;
    redirect(`/login?returnTo=${encodeURIComponent(destination)}`);
  }
  if (!actor.isActive || actor.projectsGuestOnly || !inventoryFixturesEnabled()) notFound();
  return (
    <LabelScannerFixture
      key={actor.id}
      actorId={actor.id}
      canManage={actor.type === "admin"}
      initialCode={initialCode}
    />
  );
}
