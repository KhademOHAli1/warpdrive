import type { EquipmentAuditWorkspace } from "../contracts";

export function latestAuditWorkspace(
  current: EquipmentAuditWorkspace,
  incoming: EquipmentAuditWorkspace,
): EquipmentAuditWorkspace {
  if (current.viewerId !== incoming.viewerId) return current;
  if (current.readAt === undefined) return incoming;
  if (incoming.readAt === undefined || incoming.readAt <= current.readAt) return current;

  // The latest projection determines scope. A version can only carry forward for a still-visible audit.
  const known = new Map(current.audits.map((audit) => [audit.id, audit]));
  const audits = incoming.audits.map((audit) => {
    const previous = known.get(audit.id);
    return previous?.siteId === audit.siteId && previous.version > audit.version ? previous : audit;
  });
  return audits.some((audit, index) => audit !== incoming.audits[index])
    ? { ...incoming, audits }
    : incoming;
}
