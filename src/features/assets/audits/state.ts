import type { AssetsWorkspace } from "../contracts";
import type {
  EquipmentAuditEvent,
  EquipmentAuditEvidence,
  EquipmentAuditRow,
  EquipmentAuditScope,
  EquipmentAuditStatus,
} from "./contracts";

export type AuditParticipant = { id: string; name: string };
export type AuditFixtureRole = "manager" | "base" | "self_service" | "viewer";
export type AuditFixtureActor = AuditParticipant & {
  roles: Readonly<Record<string, AuditFixtureRole>>;
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
  rows: AuditFinding[];
  activity: EquipmentAuditEvent[];
  evidence: EquipmentAuditEvidence[];
};

export type AuditFixtureState = {
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

export type AuditClock = { now: string; makeId: () => string };

export function createAuditFixtureState(
  assets: AssetsWorkspace,
  participants: AuditFixtureState["participants"] = {},
): AuditFixtureState {
  return { assets, participants, audits: [], requests: {} };
}

export function canManageAudit(state: AuditFixtureState, actor: AuditFixtureActor, siteId: string) {
  return (
    actor.active !== false &&
    actor.roles[siteId] === "manager" &&
    state.assets.sites.some((site) => site.id === siteId)
  );
}

export function auditAuthority(
  state: AuditFixtureState,
  actor: AuditFixtureActor,
  audit: AuditRecord,
) {
  const { siteId, status, archived } = audit;
  if (actor.active === false || !state.assets.sites.some(({ id }) => id === siteId)) return null;
  const role = actor.roles[siteId];
  const manager = role === "manager";
  const assigned =
    (role === "base" || role === "self_service") &&
    audit.assignees.some(({ id }) => id === actor.id) &&
    state.participants[siteId]?.some(({ id }) => id === actor.id) === true;
  if (!manager && !assigned) return null;
  return { canManage: manager, canCount: !archived && (status === "draft" || status === "active") };
}
