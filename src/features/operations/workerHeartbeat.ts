import { QUEUE_SCHEMA } from "@/jobs/schemaContract";
import { type OperationsObservation, operationsObservationSchema } from "./contracts";

export const OPERATIONS_WORKER_INSTANCE_NAME = "warpdrive-worker";
export const OPERATIONS_WORKER_HEARTBEAT_SECONDS = 30;
const reviewedVersion = "12.38.2";
const registryLimit = 1_024;
const quietBeats = 3;

type RegistrySnapshot = {
  capped: boolean;
  live_count: number;
  process_generation: string | null;
  started_at: Date | null;
  sampled_at: Date | null;
};
type ReadRegistry = (config: {
  text: string;
  values: [string, string, number, number, number];
  query_timeout: number;
}) => Promise<{ rows: RegistrySnapshot[] }>;

const unavailable = (reason: "not_reported" | "sample_failed") =>
  ({
    kind: "heartbeat",
    component: "worker",
    state: "unknown",
    reason,
    processGeneration: null,
    uptimeMs: null,
    activeCallbacks: null,
  }) as const;

/** Read the existing pg-boss registry beat. A live instance does not establish job readiness. */
export async function sampleWorkerHeartbeat(
  pool: { query: ReadRegistry },
  signal: AbortSignal,
): Promise<OperationsObservation> {
  signal.throwIfAborted();
  const { rows } = await pool.query({
    text: `
      WITH registry AS MATERIALIZED (
        SELECT id, name, version, schedule, supervise, migrate, started_on, heartbeat_on,
               heartbeat_seconds, stopped_on
        FROM ${QUEUE_SCHEMA}.instance
        LIMIT ($3::int + 1)
      ), live AS MATERIALIZED (
        SELECT id, started_on, heartbeat_on
        FROM registry
        WHERE name = $1 AND version = $2 AND schedule AND supervise AND NOT migrate
          AND stopped_on IS NULL AND heartbeat_seconds = $5
          AND heartbeat_on BETWEEN statement_timestamp() - heartbeat_seconds * $4::int * interval '1 second'
                               AND statement_timestamp()
          AND started_on <= heartbeat_on
      )
      SELECT (SELECT count(*) FROM registry) > $3 AS capped,
             (SELECT count(*)::int FROM live) AS live_count,
             candidate.id AS process_generation, candidate.started_on AS started_at,
             candidate.heartbeat_on AS sampled_at
      FROM (VALUES (1)) AS sample(row)
      LEFT JOIN LATERAL (SELECT id, started_on, heartbeat_on FROM live LIMIT 1) AS candidate ON true
    `,
    values: [
      OPERATIONS_WORKER_INSTANCE_NAME,
      reviewedVersion,
      registryLimit,
      quietBeats,
      OPERATIONS_WORKER_HEARTBEAT_SECONDS,
    ],
    query_timeout: 2_000,
  });
  signal.throwIfAborted();
  const [row] = rows;
  if (rows.length !== 1 || row === undefined || row.capped || row.live_count > 1) {
    return unavailable("sample_failed");
  }
  if (row.live_count === 0) return unavailable("not_reported");
  if (
    row.live_count !== 1 ||
    typeof row.process_generation !== "string" ||
    !(row.started_at instanceof Date) ||
    !(row.sampled_at instanceof Date)
  ) {
    return unavailable("sample_failed");
  }
  const result = operationsObservationSchema.safeParse({
    kind: "heartbeat",
    component: "worker",
    state: "healthy",
    reason: "ok",
    processGeneration: row.process_generation,
    sampledAtMs: row.sampled_at.getTime(),
    uptimeMs: row.sampled_at.getTime() - row.started_at.getTime(),
    activeCallbacks: null,
  });
  return result.success ? result.data : unavailable("sample_failed");
}
