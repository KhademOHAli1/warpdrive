import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  operationsCurrent,
  operationsIncidents,
  operationsReceipts,
  operationsSources,
  operationsTransitions,
} from "@/db/schema";
import {
  OPERATIONS_CLOSED_INCIDENT_LIMIT,
  OPERATIONS_MAX_RETAINED_PAYLOAD_BYTES,
  OPERATIONS_RECEIPT_LIMIT,
  OPERATIONS_TRANSITION_LIMIT,
} from "./retention";
import { OPERATIONS_SOURCE_LIMIT, operationsTransaction } from "./storage";

/** Internal qualification/sampler only. Not a UI aggregate or a physical disk
 * reservation: measured heap/TOAST/index bytes remain separate from logical caps.
 */
export async function sampleOperationsStorage(db: Db, signal: AbortSignal) {
  return operationsTransaction(db, signal, async (tx, bounded) => {
    const counts = await tx.execute<{
      sources: number;
      receipts: number;
      current: number;
      incidents: number;
      transitions: number;
      payload_bytes: string;
    }>(sql`SELECT
      (SELECT count(*)::int FROM ${operationsSources}) AS sources,
      (SELECT count(*)::int FROM ${operationsReceipts}) AS receipts,
      (SELECT count(*)::int FROM ${operationsCurrent}) AS current,
      (SELECT count(*)::int FROM ${operationsIncidents}) AS incidents,
      (SELECT count(*)::int FROM ${operationsTransitions}) AS transitions,
      (SELECT coalesce(sum(octet_length(${operationsReceipts.payload}::text)),0)::text FROM ${operationsReceipts}) AS payload_bytes`);
    const bytes = await tx.execute<{
      name: string;
      table_bytes: string;
      index_bytes: string;
      total_bytes: string;
    }>(sql`SELECT c.relname AS name,
      pg_table_size(c.oid)::text AS table_bytes,pg_indexes_size(c.oid)::text AS index_bytes,pg_total_relation_size(c.oid)::text AS total_bytes
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
      AND c.relname IN ('operations_installation','operations_sources','operations_receipts','operations_current','operations_incidents','operations_transitions')
      ORDER BY c.relname`);
    bounded.throwIfAborted();
    return {
      counts: counts.rows[0] ?? null,
      relations: bytes.rows.map((row) => ({
        name: row.name,
        tableBytes: Number(row.table_bytes),
        indexBytes: Number(row.index_bytes),
        totalBytes: Number(row.total_bytes),
      })),
      logicalPolicy: {
        sourceLimit: OPERATIONS_SOURCE_LIMIT,
        receiptLimitPerSource: OPERATIONS_RECEIPT_LIMIT,
        retainedPayloadBytesUpperBound: OPERATIONS_MAX_RETAINED_PAYLOAD_BYTES,
        closedIncidentLimitPerSource: OPERATIONS_CLOSED_INCIDENT_LIMIT,
        transitionsPerIncident: OPERATIONS_TRANSITION_LIMIT,
      },
      limitation:
        "Logical caps exclude PostgreSQL row/index/TOAST/free-space/WAL overhead; measured relation sizes are not installed disk sizing.",
    };
  });
}
