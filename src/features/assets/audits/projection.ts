import type {
  EquipmentAuditDetail,
  EquipmentAuditLookup,
  EquipmentAuditProgress,
  EquipmentAuditRead,
  EquipmentAuditResultStatus,
  EquipmentAuditRow,
  EquipmentAuditSite,
  EquipmentAuditSummary,
  EquipmentAuditWorkspace,
} from "./contracts";
import { siteAuditLocations, siteAuditTags, siteAuditTargets } from "./snapshot";
import {
  type AuditEquipmentIdentity,
  type AuditEquipmentResolver,
  type AuditFinding,
  type AuditFixtureActor,
  type AuditFixtureState,
  type AuditRecord,
  auditAuthority,
  canManageAudit,
} from "./state";

function findingResult(
  { expected, counted }: AuditFinding,
  completed: boolean,
): EquipmentAuditResultStatus {
  if (expected === null) return counted === null ? "not_scanned" : "unexpected";
  if (counted === null) return completed ? "missing" : "not_scanned";
  if (counted === 0) return completed ? "missing" : "partial";
  return counted < expected ? "partial" : "found";
}

function progress(audit: AuditRecord): EquipmentAuditProgress {
  const completed = audit.status === "completed";
  const summary: EquipmentAuditProgress = {
    expectedRows: 0,
    foundRows: 0,
    outstandingRows: 0,
    missingRows: 0,
    unexpectedRows: 0,
    expectedUnits: 0,
    foundUnits: 0,
    missingUnits: 0,
    unexpectedUnits: 0,
  };
  for (const row of audit.rows) {
    if (row.expected === null) {
      if (row.counted !== null) {
        summary.unexpectedRows++;
        summary.unexpectedUnits += row.counted;
      }
      continue;
    }
    const counted = row.counted ?? 0;
    summary.expectedRows++;
    summary.expectedUnits += row.expected;
    summary.foundUnits += Math.min(counted, row.expected);
    summary.unexpectedUnits += Math.max(0, counted - row.expected);
    if (counted >= row.expected) summary.foundRows++;
    else if (!completed) summary.outstandingRows++;
    else {
      summary.missingRows++;
      summary.missingUnits += row.expected - counted;
    }
  }
  return summary;
}

function summary(audit: AuditRecord): EquipmentAuditSummary {
  const {
    id,
    siteId,
    version,
    title,
    status,
    archived,
    createdAt,
    dueAt,
    startedAt,
    completedAt,
    reviewedAt,
    assignees,
  } = audit;
  return {
    id,
    siteId,
    version,
    title,
    status,
    archived,
    createdAt,
    dueAt,
    startedAt,
    completedAt,
    reviewedAt,
    assignees,
    progress: progress(audit),
  };
}

function auditSite(
  state: AuditFixtureState,
  site: { id: string; name: string },
  canManage: boolean,
): EquipmentAuditSite {
  const { id, name } = site;
  if (!canManage)
    return {
      id,
      name,
      canManage,
      locations: [],
      targets: [],
      categories: [],
      tags: [],
      auditors: [],
    };
  const { assets } = state;
  return {
    id,
    name,
    canManage,
    locations: siteAuditLocations(assets, id).map(({ id, name, parentId }) => ({
      id,
      name,
      parentId,
    })),
    targets: siteAuditTargets(assets, id),
    categories: assets.categories
      .filter((row) => row.siteId === id)
      .map(({ id, name }) => ({ id, name })),
    tags: siteAuditTags(assets, id),
    auditors: [...(state.participants[id] ?? [])],
  };
}

export function projectAuditWorkspace(
  state: AuditFixtureState,
  actor: AuditFixtureActor,
): EquipmentAuditWorkspace {
  const visible = state.audits.filter((audit) => auditAuthority(state, actor, audit) !== null);
  const visibleSites = new Set(visible.map(({ siteId }) => siteId));
  return {
    viewerId: actor.id,
    sites: state.assets.sites.flatMap((site) => {
      const manage = canManageAudit(state, actor, site.id);
      return manage || visibleSites.has(site.id) ? [auditSite(state, site, manage)] : [];
    }),
    audits: visible.map(summary),
  };
}

function present(row: AuditFinding, audit: AuditRecord, canCount: boolean): EquipmentAuditRow {
  const { id, target, serial, sourceVersion, placement, quantityType, expected, counted } = row;
  return {
    id,
    target,
    serial,
    sourceVersion,
    placement,
    quantityType,
    expected,
    counted,
    result: findingResult(row, audit.status === "completed"),
    canUndo: canCount && audit.status === "active" && counted !== null,
  };
}

export function auditProjectionScope(
  state: AuditFixtureState,
  actor: AuditFixtureActor,
  auditId: string,
) {
  const audit = state.audits.find(({ id }) => id === auditId);
  if (audit === undefined) return null;
  const site = state.assets.sites.find(({ id }) => id === audit.siteId);
  const authority = auditAuthority(state, actor, audit);
  return site === undefined || authority === null ? null : { audit, site, ...authority };
}

export function projectAuditDetail(
  state: AuditFixtureState,
  actor: AuditFixtureActor,
  auditId: string,
): EquipmentAuditRead {
  const scope = auditProjectionScope(state, actor, auditId);
  if (scope === null) return { ok: false, error: "unavailable" };
  const { audit, site, canManage, canCount } = scope;
  const value: EquipmentAuditDetail = {
    ...summary(audit),
    siteName: site.name,
    scope: audit.scope,
    canManage,
    canCount,
    rows: audit.rows
      .filter(({ expected, counted }) => expected !== null || counted !== null)
      .map((row) => present(row, audit, canCount)),
    activity: audit.activity,
    evidence: audit.evidence,
  };
  return { ok: true, value };
}

export function auditOpaqueKey(code: string) {
  return code.trim();
}

function rowsMatching(audit: AuditRecord, target: AuditEquipmentIdentity | null, code: string) {
  if (target === null) return audit.rows.filter((row) => row.opaqueKey === auditOpaqueKey(code));
  return audit.rows.filter((row) =>
    target.kind === "asset"
      ? row.target?.id === target.id
      : row.placement.kitId === target.id || row.target?.id === target.id,
  );
}

export function resolveVisibleAuditEquipment(
  state: AuditFixtureState,
  audit: AuditRecord,
  canManage: boolean,
  code: string,
  resolve: AuditEquipmentResolver,
) {
  const identity = resolve(audit.siteId, code);
  const targets = siteAuditTargets(state.assets, audit.siteId);
  const current =
    identity === null
      ? undefined
      : targets.find(({ id, kind }) => id === identity.id && kind === identity.kind);
  const known = current === undefined ? null : identity;
  const matched = rowsMatching(audit, known, code);
  const announced =
    matched.some((row) => row.expected !== null || (row.target !== null && row.counted !== null)) ||
    canManage;
  const label = known?.kind === "kit" ? current?.name : (matched[0]?.target?.name ?? current?.name);
  return {
    target: announced ? known : null,
    label: announced ? (label ?? null) : null,
    rows: announced ? matched : rowsMatching(audit, null, code),
  };
}

export function lookupAuditEquipment(
  state: AuditFixtureState,
  actor: AuditFixtureActor,
  auditId: string,
  code: string,
  resolve: AuditEquipmentResolver,
): EquipmentAuditLookup {
  const scope = auditProjectionScope(state, actor, auditId);
  if (scope === null || !scope.canCount) return { ok: false, error: "unavailable" };
  if (scope.audit.status !== "active") return { ok: false, error: "state" };
  const input = code.trim();
  if (input.length === 0 || input.length > 4096 || input.includes("\u0000"))
    return { ok: false, error: "invalid" };
  const { target, label, rows } = resolveVisibleAuditEquipment(
    state,
    scope.audit,
    scope.canManage,
    input,
    resolve,
  );
  return {
    ok: true,
    targetId: target?.id ?? null,
    label,
    rows: rows.filter((row) => row.expected !== null || row.counted !== null).map(({ id }) => id),
  };
}
