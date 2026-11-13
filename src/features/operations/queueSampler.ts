import { QUEUE_SCHEMA } from "@/jobs/schemaContract";
import {
  type OperationsObservation,
  operationsObservationSchema,
  operationsQueues,
} from "./contracts";

const maxQueueAgeMs = 5 * 60_000;
export type OperationsQueueCacheRow = {
  name: (typeof operationsQueues)[number];
  sampled_at: Date | null;
  pending_count: number;
  active_count: number;
  ready_oldest_seconds: number | null;
  last_progress_at: Date | null;
  ready_count: number;
  sampled_age_ms: number | null;
};
type ReadQueueCache = (config: {
  text: string;
  values: unknown[];
  query_timeout: number;
}) => Promise<{ rows: OperationsQueueCacheRow[] }>;

/** Read existing monitor facts by queue primary key. Never aggregate or refresh the job table. */
export async function sampleOperationsQueues(
  pool: { query: ReadQueueCache },
  signal: AbortSignal,
): Promise<OperationsObservation[]> {
  signal.throwIfAborted();
  const { rows } = await pool.query({
    text: `
      SELECT name, monitor_on AS sampled_at, queued_count AS pending_count, active_count,
             ready_count, ready_oldest_seconds,
             CASE WHEN completed_delta > 0 THEN delta_on END AS last_progress_at,
             (extract(epoch FROM (clock_timestamp() - monitor_on)) * 1000)::float8 AS sampled_age_ms
      FROM ${QUEUE_SCHEMA}.queue
      WHERE name = ANY($1::text[])
    `,
    values: [operationsQueues],
    query_timeout: 2_000,
  });
  signal.throwIfAborted();
  const cached = new Map(rows.map((row) => [row.name, row]));
  return operationsQueues.map((queue) => {
    const row = cached.get(queue);
    const base = {
      kind: "queue" as const,
      queue,
      sampledAtMs: null,
      pendingCount: null,
      activeCount: null,
      readyOldestAgeMs: null,
      lastProgressAtMs: null,
    };
    if (row?.sampled_at == null || row.sampled_age_ms === null)
      return { ...base, state: "unknown", reason: "not_reported" };
    const readyOldestAgeMs =
      row.ready_oldest_seconds === null ? null : row.ready_oldest_seconds * 1000;
    const aged =
      readyOldestAgeMs !== null && readyOldestAgeMs > maxQueueAgeMs && row.ready_count > 0;
    const result = operationsObservationSchema.safeParse({
      ...base,
      state: aged ? "degraded" : "healthy",
      reason: aged ? "queue_backlog" : "ok",
      sampledAtMs: row.sampled_at.getTime(),
      pendingCount: row.pending_count,
      activeCount: row.active_count,
      readyOldestAgeMs,
      lastProgressAtMs: row.last_progress_at?.getTime() ?? null,
    });
    if (!result.success || row.sampled_age_ms < -30_000)
      return { ...base, state: "unknown", reason: "sample_failed" };
    return result.data;
  });
}
