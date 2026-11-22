import type { AssetsWorkspace } from "../../contracts";
import { findingResult } from "../projection";
import { type AuditActor, type AuditRecord, type AuditState, auditAuthority } from "../state";
import {
  type AssetAuditCountEvent,
  type AssetAuditFinding,
  type AssetAuditHistoryEntry,
  type AssetAuditHistoryResult,
  assetAuditHistoryMaxEntries,
} from "./contracts";

function countActivity(
  audit: Pick<AuditRecord, "activity">,
  rowId: string,
): AssetAuditCountEvent[] {
  return audit.activity
    .flatMap(({ rowId: id, kind, actor, at, id: eventId, before, after, note }) =>
      id === rowId && (kind === "counted" || kind === "unexpected" || kind === "undone")
        ? [{ id: eventId, kind, actor, at, before, after, note }]
        : [],
    )
    .reverse();
}

export function assetAuditHistoryEntry(
  audit: Pick<
    AuditRecord,
    "id" | "title" | "status" | "archived" | "completedAt" | "rows" | "activity"
  >,
  assetId: string,
): AssetAuditHistoryEntry | null {
  if (audit.status !== "completed" || audit.completedAt === null) return null;
  const findings = audit.rows.flatMap((row): AssetAuditFinding[] => {
    if (row.target?.kind !== "asset" || row.target.id !== assetId) return [];
    const activity = countActivity(audit, row.id);
    const { id, expected, counted, serial, placement } = row;
    const withdrawn = expected === null && counted === null;
    if (withdrawn && !activity.some(({ kind }) => kind === "unexpected")) return [];
    return [
      {
        id,
        name: row.target.name,
        serial,
        expected,
        counted,
        result: withdrawn ? "withdrawn" : findingResult(row, true),
        placement: { kind: placement.kind, label: placement.label },
        activity,
      },
    ];
  });
  return findings.length === 0
    ? null
    : {
        auditId: audit.id,
        title: audit.title,
        status: audit.status,
        archived: audit.archived,
        at: audit.completedAt,
        findings,
      };
}

export function projectAssetAuditHistory(
  state: AuditState,
  actor: AuditActor,
  register: AssetsWorkspace,
  assetId: string,
): AssetAuditHistoryResult {
  const asset = register.records.find(({ id }) => id === assetId);
  const role = asset === undefined ? undefined : actor.roles[asset.siteId];
  if (
    asset === undefined ||
    role === undefined ||
    role === "viewer" ||
    actor.active === false ||
    !register.sites.some(({ id }) => id === asset.siteId)
  ) {
    return { ok: false, error: "unavailable" };
  }

  const entries = state.audits.flatMap((audit) => {
    if (audit.siteId !== asset.siteId || auditAuthority(state, actor, audit) === null) return [];
    const entry = assetAuditHistoryEntry(audit, assetId);
    return entry === null ? [] : [entry];
  });
  entries.sort((a, b) => b.at.localeCompare(a.at) || b.auditId.localeCompare(a.auditId));
  return entries.length > assetAuditHistoryMaxEntries
    ? { ok: true, entries: entries.slice(0, assetAuditHistoryMaxEntries), truncated: true }
    : { ok: true, entries };
}
