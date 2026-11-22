import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { EquipmentAuditEvent } from "../contracts";
import { assetAuditAssignments, assetAuditEvents, assetAuditRows, assetAudits } from "../schema";
import type { AuditFinding } from "../state";
import { assetAuditHistoryMaxEntries } from "./contracts";

export const assetAuditHistoryMaxFindings = 32;
const maxCountEvents = 12;

type HistoryFinding = AuditFinding & {
  earliest: EquipmentAuditEvent | null;
  recent: EquipmentAuditEvent[];
};

type HistoryAudit = {
  id: string;
  title: string;
  archived: boolean;
  completedAt: string;
  findings: HistoryFinding[];
};

type HistoryScope = { siteId: string; assetId: string; assignedUserId: string | null };

const countEvents = sql`e.site_id = f.site_id AND e.audit_id = f.audit_id AND e.row_id = f.id
  AND e.row_id IS NOT NULL AND e.snapshot ->> 'kind' IN ('counted', 'unexpected', 'undone')`;

const countSnapshot = sql`e.snapshot || jsonb_build_object(
  'id', e.id, 'rowId', e.row_id, 'at', e.at
)`;

const withdrawn = sql`EXISTS (
  SELECT 1 FROM ${assetAuditEvents} AS e
  WHERE ${countEvents} AND e.snapshot ->> 'kind' = 'unexpected'
) AND (
  SELECT e.snapshot ->> 'kind' FROM ${assetAuditEvents} AS e
  WHERE ${countEvents} ORDER BY e.version DESC, e.ordinal DESC LIMIT 1
) = 'undone'`;

export async function readScopedAssetAuditHistory(
  tx: Db,
  { siteId, assetId, assignedUserId }: HistoryScope,
) {
  const auditScope =
    assignedUserId === null
      ? sql`TRUE`
      : sql`EXISTS (
      SELECT 1 FROM ${assetAuditAssignments} AS assignment
      WHERE assignment.site_id = a.site_id AND assignment.audit_id = a.id
        AND assignment.user_id = ${assignedUserId}
    )`;
  const results = await tx.execute<HistoryAudit>(sql`
    WITH exact_findings AS NOT MATERIALIZED (
      SELECT f.* FROM ${assetAuditRows} AS f
      WHERE f.site_id = ${siteId} AND f.opaque_key IS NULL
        AND f.identity #>> '{target,kind}' = 'asset'
        AND f.identity #>> '{target,id}' = ${assetId}
        AND (f.expected IS NOT NULL OR f.counted IS NOT NULL OR (${withdrawn}))
    ), chosen AS (
      SELECT a.id, a.site_id, a.title, a.archived, a.completed_at
      FROM ${assetAudits} AS a
      WHERE a.site_id = ${siteId} AND a.status = 'completed' AND a.completed_at IS NOT NULL
        AND ${auditScope}
        AND EXISTS (
          SELECT 1 FROM exact_findings AS f WHERE f.site_id = a.site_id AND f.audit_id = a.id
        )
      ORDER BY a.completed_at DESC, a.id DESC
      LIMIT ${assetAuditHistoryMaxEntries + 1}
    )
    SELECT a.id, a.title, a.archived, to_jsonb(a.completed_at) #>> '{}' AS "completedAt",
      matches.findings
    FROM chosen AS a
    CROSS JOIN LATERAL (
      SELECT jsonb_agg(f.identity || jsonb_build_object(
        'id', f.id, 'expected', f.expected, 'counted', f.counted, 'opaqueKey', NULL,
        'earliest', (
          SELECT ${countSnapshot} FROM ${assetAuditEvents} AS e
          WHERE ${countEvents} ORDER BY e.version, e.ordinal LIMIT 1
        ),
        'recent', to_jsonb(ARRAY(
          SELECT ${countSnapshot} FROM ${assetAuditEvents} AS e
          WHERE ${countEvents} ORDER BY e.version DESC, e.ordinal DESC LIMIT ${maxCountEvents}
        ))
      ) ORDER BY f.position, f.id) AS findings
      FROM (
        SELECT f.* FROM exact_findings AS f
        WHERE f.site_id = a.site_id AND f.audit_id = a.id
        ORDER BY f.position, f.id LIMIT ${assetAuditHistoryMaxFindings + 1}
      ) AS f
    ) AS matches
    ORDER BY a.completed_at DESC, a.id DESC
  `);
  return results.rows;
}

export function auditFindingActivity({ earliest, recent }: HistoryFinding) {
  // Keep the first observation and the latest corrections when the middle does not fit.
  const truncated = earliest !== null && !recent.some(({ id }) => id === earliest.id);
  const rows = truncated ? [...recent.slice(0, maxCountEvents - 1), earliest] : recent;
  return {
    truncated,
    activity: rows.map((event) => ({ ...event, at: new Date(event.at).toISOString() })),
  };
}
