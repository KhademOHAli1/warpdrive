import type { AssetsWorkspace } from "../../contracts";
import type { BookingHandoverLookup } from "./contracts";

type EquipmentIdentity = Extract<BookingHandoverLookup, { ok: true }>;
type Target = Pick<EquipmentIdentity, "id" | "kind">;

export function activeEquipment(workspace: AssetsWorkspace, siteId: string, { id, kind }: Target) {
  if (kind === "kit") {
    return workspace.kits?.records.some((kit) => kit.id === id && kit.siteId === siteId) === true;
  }
  return workspace.records.some(
    (asset) => asset.id === id && asset.siteId === siteId && asset.archivedAt === null,
  );
}

export function equipmentByPrintedCode(
  workspace: AssetsWorkspace,
  siteId: string,
  value: string,
): EquipmentIdentity | null | undefined {
  const code = value.trim().toUpperCase();
  const candidates: EquipmentIdentity[] = [
    ...workspace.records
      .filter(
        (asset) =>
          asset.siteId === siteId &&
          asset.archivedAt === null &&
          (asset.code.toUpperCase() === code ||
            (asset.tracking === "individual" && asset.serial?.toUpperCase() === code)),
      )
      .map(({ id }) => ({ ok: true as const, kind: "asset" as const, id })),
    ...(workspace.kits?.records ?? [])
      .filter((kit) => kit.siteId === siteId && kit.code.toUpperCase() === code)
      .map(({ id }) => ({ ok: true as const, kind: "kit" as const, id })),
  ];
  return candidates.length > 1 ? null : candidates[0];
}
