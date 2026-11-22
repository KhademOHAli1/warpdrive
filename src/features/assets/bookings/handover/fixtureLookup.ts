import { resolveLabelFixture } from "@/features/physical-labels/fixtureState";
import type { AssetsWorkspace } from "../../contracts";
import { scanTagFromLabelFixture } from "../../tags/fixtureScans";
import type { BookingHandoverLookup } from "./contracts";

export function lookupFixtureEquipment(
  workspace: AssetsWorkspace,
  siteId: string,
  actorId: string,
  origin: string,
  value: string,
): BookingHandoverLookup {
  const matches = workspace.records.filter(
    (asset) => asset.siteId === siteId && asset.archivedAt === null,
  );
  const kits = workspace.kits?.records.filter((kit) => kit.siteId === siteId) ?? [];
  const code = value.trim().toUpperCase();
  const direct: Extract<BookingHandoverLookup, { ok: true }>[] = [
    ...matches
      .filter(
        (asset) =>
          asset.code.toUpperCase() === code ||
          (asset.tracking === "individual" && asset.serial?.toUpperCase() === code),
      )
      .map(({ id }) => ({ ok: true as const, kind: "asset" as const, id })),
    ...kits
      .filter((kit) => kit.code.toUpperCase() === code)
      .map(({ id }) => ({ ok: true as const, kind: "kit" as const, id })),
  ];
  if (direct.length === 1 && direct[0] !== undefined) return direct[0];
  const unavailable = { ok: false, error: "unavailable" } as const;
  if (direct.length > 1) return unavailable;

  const label =
    scanTagFromLabelFixture(actorId, true, origin, { value }) ??
    resolveLabelFixture(actorId, true, origin, { value });
  if (!label.ok) return unavailable;
  const { target } = label.label;
  if (target.kind === "asset" && matches.some(({ id }) => id === target.id))
    return { ok: true, kind: target.kind, id: target.id };
  if (target.kind === "kit" && kits.some(({ id }) => id === target.id))
    return { ok: true, kind: target.kind, id: target.id };
  return unavailable;
}
