export const auditPhotoMaxBytes = 5 * 1024 * 1024;
export const auditPhotoTypes = ["image/jpeg", "image/png"] as const;
export type EquipmentAuditPhotoMime = (typeof auditPhotoTypes)[number];

export const auditPhotoHeaders = {
  actor: "x-equipment-audit-actor",
  csrf: "x-csrf-token",
  row: "x-equipment-audit-row",
  version: "x-equipment-audit-version",
  request: "x-equipment-audit-request",
  source: "x-equipment-audit-source",
  name: "x-equipment-audit-filename",
} as const;

export function equipmentAuditEvidencePath(auditId: string, evidenceId?: string) {
  const path = `/api/assets/audits/${encodeURIComponent(auditId)}/evidence`;
  return evidenceId === undefined ? path : `${path}?evidenceId=${encodeURIComponent(evidenceId)}`;
}
