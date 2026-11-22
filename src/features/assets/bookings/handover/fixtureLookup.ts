import { resolveLabelFixture } from "@/features/physical-labels/fixtureState";
import type { AssetsWorkspace } from "../../contracts";
import { scanTagFromLabelFixture } from "../../tags/fixtureScans";
import type { BookingHandoverLookup } from "./contracts";
import { activeEquipment, equipmentByPrintedCode } from "./equipmentIdentity";

export function lookupFixtureEquipment(
  workspace: AssetsWorkspace,
  siteId: string,
  actorId: string,
  origin: string,
  value: string,
): BookingHandoverLookup {
  const unavailable = { ok: false, error: "unavailable" } as const;
  const direct = equipmentByPrintedCode(workspace, siteId, value);
  if (direct !== undefined) return direct ?? unavailable;
  const label =
    scanTagFromLabelFixture(actorId, true, origin, { value }) ??
    resolveLabelFixture(actorId, true, origin, { value });
  if (!label.ok) return unavailable;
  const { id, kind } = label.label.target;
  return (kind === "asset" || kind === "kit") && activeEquipment(workspace, siteId, { id, kind })
    ? { ok: true, id, kind }
    : unavailable;
}
