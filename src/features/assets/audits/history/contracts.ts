import type {
  EquipmentAuditEvent,
  EquipmentAuditPlacement,
  EquipmentAuditRow,
  EquipmentAuditSummary,
} from "../contracts";

export const assetAuditHistoryMaxEntries = 4;

export type AssetAuditCountEvent = Pick<
  EquipmentAuditEvent,
  "id" | "at" | "actor" | "before" | "after" | "note"
> & {
  kind: "counted" | "unexpected" | "undone";
};

export type AssetAuditFinding = Pick<
  EquipmentAuditRow,
  "id" | "serial" | "expected" | "counted"
> & {
  name: string;
  result: EquipmentAuditRow["result"] | "withdrawn";
  placement: Pick<EquipmentAuditPlacement, "kind" | "label">;
  activity: AssetAuditCountEvent[];
};

export type AssetAuditHistoryEntry = Pick<
  EquipmentAuditSummary,
  "title" | "status" | "archived"
> & {
  auditId: string;
  at: string;
  findings: AssetAuditFinding[];
};

export type AssetAuditHistoryResult =
  | { ok: true; entries: AssetAuditHistoryEntry[]; truncated?: true }
  | { ok: false; error: "unavailable" };

export type AssetAuditHistoryAccess = (
  assetId: string,
  signal?: AbortSignal,
) => Promise<AssetAuditHistoryResult>;
