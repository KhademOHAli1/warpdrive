import type { AssetsWorkspace } from "../contracts";
import type {
  EquipmentAuditEvent,
  EquipmentAuditEvidence,
  EquipmentAuditRow,
  EquipmentAuditScope,
  EquipmentAuditStatus,
} from "./contracts";

export type AuditParticipant = { id: string; name: string };
export type AuditRole = "manager" | "base" | "self_service" | "viewer";
export type AuditActor = AuditParticipant & {
  roles: Readonly<Record<string, AuditRole>>;
  active?: boolean;
};

export type AuditFinding = Omit<EquipmentAuditRow, "result" | "canUndo"> & {
  opaqueKey: string | null;
};

export type AuditRecord = {
  id: string;
  siteId: string;
  version: number;
  title: string;
  status: EquipmentAuditStatus;
  archived: boolean;
  createdAt: string;
  dueAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  reviewedAt: string | null;
  scope: EquipmentAuditScope;
  assignees: AuditParticipant[];
  assignedUserIds?: readonly string[];
  rows: AuditFinding[];
  activity: EquipmentAuditEvent[];
  evidence: EquipmentAuditEvidence[];
};

export type AuditState = {
  assets: AssetsWorkspace;
  participants: Readonly<Record<string, readonly AuditParticipant[]>>;
  audits: readonly AuditRecord[];
  requests: Readonly<Record<string, { auditId: string; fingerprint: string }>>;
};

export type AuditEquipmentIdentity = { id: string; kind: "asset" | "kit" };
export type AuditEquipmentResolver = (
  siteId: string,
  code: string,
) => AuditEquipmentIdentity | null;

export type AuditOpaqueKey = (siteId: string, code: string) => string;
export type AuditEvidenceHref = (auditId: string, evidenceId: string) => string;

export type AuditClock = { now: string; makeId: () => string; opaqueKeyFor?: AuditOpaqueKey };

export function createAuditState(
  assets: AssetsWorkspace,
  participants: AuditState["participants"] = {},
): AuditState {
  return { assets, participants, audits: [], requests: {} };
}

export function canManageAudit(state: AuditState, actor: AuditActor, siteId: string) {
  return (
    actor.active !== false &&
    actor.roles[siteId] === "manager" &&
    state.assets.sites.some((site) => site.id === siteId)
  );
}

export function auditAuthority(state: AuditState, actor: AuditActor, audit: AuditRecord) {
  const { siteId, status, archived } = audit;
  if (actor.active === false || !state.assets.sites.some(({ id }) => id === siteId)) return null;
  const role = actor.roles[siteId];
  const manager = role === "manager";
  const assigned =
    (role === "base" || role === "self_service") &&
    (audit.assignedUserIds?.includes(actor.id) ??
      audit.assignees.some(({ id }) => id === actor.id)) &&
    state.participants[siteId]?.some(({ id }) => id === actor.id) === true;
  if (!manager && !assigned) return null;
  return { canManage: manager, canCount: !archived && (status === "draft" || status === "active") };
}

export type {
  AuditActor as AuditFixtureActor,
  AuditRole as AuditFixtureRole,
  AuditState as AuditFixtureState,
};
export { createAuditState as createAuditFixtureState };
