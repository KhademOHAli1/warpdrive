import { Pool, type PoolClient } from "pg";
import { z } from "zod";
import { currencyCode } from "@/features/currencies/currencySchema";
import { isTimeZone } from "@/features/i18n/preferences";
import type { PermSetUser } from "@/features/permissions/effective";
import {
  ANALYTICS_HISTORY_SCHEMA_VERSION,
  analyticsHistoryEvent,
  historyUuid,
  historyVisibilitySnapshot,
} from "./contracts";

const MAX_WITNESS_BYTES = 1_048_576;
const MAX_CHECKOUT_MS = 5_000;
const MAX_QUERY_MS = 10_000;
const uuid = historyUuid.transform((value) => value.toLowerCase());
const instant = z.string().datetime({ precision: 6 });
const digest = z.string().regex(/^[0-9a-f]{64}$/u);
const witness = z.string().max(MAX_WITNESS_BYTES).pipe(historyVisibilitySnapshot);

const receiptSchema = z.strictObject({
  snapshotId: uuid,
  activationId: uuid,
  requestKey: uuid,
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/u)
    .pipe(currencyCode),
  writerXid: analyticsHistoryEvent.shape.transactionId,
  captureSnapshot: witness,
  predictionCutoff: instant,
  insertedAt: instant,
  requestSha256: digest,
  payloadSha256: digest,
  target: z.strictObject({
    from: instant,
    toExclusive: instant,
    fromDate: z.string().date(),
    toExclusiveDate: z.string().date(),
    timeZone: z.string().min(1).max(100).refine(isTimeZone),
    calendar: z.enum(["gregory", "persian"]),
  }),
});

const observedSchema = z.strictObject({
  confirmedAt: instant,
  confirmationSnapshot: witness,
  rowXmin: z.string().regex(/^[1-9]\d{0,9}$/u),
});

export type ForecastCommitExpectation = z.input<typeof receiptSchema>;
type Receipt = z.output<typeof receiptSchema>;
type Observation = z.output<typeof observedSchema>;

export interface PrivateForecastCommitProof extends Receipt, Observation {
  definitionVersion: 1;
  basis: "independent-native-visibility-before-target";
  creatorId: string;
}

export type ForecastCommitQualification =
  | { state: "confirmed"; proof: PrivateForecastCommitProof }
  | {
      state: "unavailable";
      reason:
        | "invalid-expectation"
        | "session-unavailable"
        | "no-qualifying-receipt"
        | "read-unavailable";
    };

function hasFiniteTimeout(value: number | undefined, upper: number): boolean {
  return value !== undefined && Number.isInteger(value) && value > 0 && value <= upper;
}

function isBoundedPool(pool: Pool): boolean {
  return (
    pool instanceof Pool &&
    hasFiniteTimeout(pool.options.connectionTimeoutMillis, MAX_CHECKOUT_MS) &&
    hasFiniteTimeout(pool.options.query_timeout, MAX_QUERY_MS)
  );
}

function validFrame({ predictionCutoff, insertedAt, target }: Receipt): boolean {
  // All accepted instants use fixed UTC microseconds. Lexical order preserves precision.
  return (
    predictionCutoff <= insertedAt &&
    insertedAt < target.from &&
    target.from < target.toExclusive &&
    target.fromDate < target.toExclusiveDate
  );
}

async function readReceipt(
  client: PoolClient,
  creatorId: string,
  receipt: Receipt,
): Promise<Observation | null> {
  const { target } = receipt;
  // This is the first data statement. PostgreSQL establishes the active RR snapshot
  // before evaluation of clock_timestamp; statement_timestamp can predate that cut.
  const { rows } = await client.query<Record<string, unknown>>(
    `WITH observation AS MATERIALIZED (
       SELECT pg_catalog.pg_current_snapshot() AS witness,
         pg_catalog.clock_timestamp() AS sampled_at
       WHERE pg_catalog.current_setting('transaction_isolation') = 'repeatable read'
         AND pg_catalog.current_setting('transaction_read_only') = 'on'
         AND pg_catalog.pg_current_xact_id_if_assigned() IS NULL
         AND NOT pg_catalog.pg_is_in_recovery()
     ), eligible AS MATERIALIZED (
       SELECT o.sampled_at, o.witness, s.xmin AS row_xmin,
         s.forecast_request_bytes, s.forecast_payload_bytes,
         s.forecast_request_sha256, s.forecast_payload_sha256
       FROM public.analytics_report_snapshots s
       JOIN public.users u ON u.id = s.created_by AND u.is_active
       JOIN public.analytics_history_coverage c ON c.id AND c.activation_id = s.activation_id
         AND c.schema_version = ${ANALYTICS_HISTORY_SCHEMA_VERSION}
       CROSS JOIN observation o
       WHERE s.id = $1::uuid AND s.created_by = $2::uuid AND s.activation_id = $3::uuid
         AND s.kind = 'forecast' AND s.definition_version = 1
         AND s.forecast_request_key = $4::uuid AND s.currency = $5
         AND s.forecast_writer_xid = $6::pg_catalog.xid8
         AND s.xmin = s.forecast_writer_xid::pg_catalog.xid
         AND NOT pg_catalog.pg_visible_in_snapshot(s.forecast_writer_xid, s.transaction_snapshot)
         AND pg_catalog.pg_visible_in_snapshot(s.forecast_writer_xid, o.witness)
         AND s.transaction_snapshot::text COLLATE pg_catalog."C" = $7::text
         AND s.cutoff_observed_at = $8::timestamptz AND s.created_at = $9::timestamptz
         AND s.forecast_target_start = $10::timestamptz AND s.forecast_target_end = $11::timestamptz
         AND s.target_from = $12::date AND s.target_to_exclusive = $13::date
         AND s.time_zone COLLATE pg_catalog."C" = $14::text AND s.calendar = $15
         AND s.forecast_request_sha256 = pg_catalog.decode($16, 'hex')
         AND s.forecast_payload_sha256 = pg_catalog.decode($17, 'hex')
         AND c.activated_at <= s.cutoff_observed_at AND s.cutoff_observed_at <= s.created_at
         AND s.created_at <= o.sampled_at AND pg_catalog.transaction_timestamp() <= o.sampled_at
         AND o.sampled_at < s.forecast_target_start
         AND pg_catalog.octet_length(o.witness::text) <= $18
         AND pg_catalog.octet_length(s.forecast_request_bytes) BETWEEN 1 AND 65536
         AND pg_catalog.octet_length(s.forecast_payload_bytes) BETWEEN 1 AND 8388608
     )
     SELECT public.analytics_history_utc(sampled_at) AS "confirmedAt",
       witness::text AS "confirmationSnapshot", row_xmin::text AS "rowXmin"
     FROM eligible
     WHERE forecast_request_sha256 = pg_catalog.sha256(pg_catalog.convert_to(
       'warpdrive-forecast-request-v1' || E'\\n' || forecast_request_bytes, 'UTF8'))
       AND forecast_payload_sha256 = pg_catalog.sha256(pg_catalog.convert_to(
       'warpdrive-forecast-payload-v1' || E'\\n' || forecast_payload_bytes, 'UTF8'))`,
    [
      receipt.snapshotId,
      creatorId,
      receipt.activationId,
      receipt.requestKey,
      receipt.currency,
      receipt.writerXid,
      receipt.captureSnapshot,
      receipt.predictionCutoff,
      receipt.insertedAt,
      target.from,
      target.toExclusive,
      target.fromDate,
      target.toExclusiveDate,
      target.timeZone,
      target.calendar,
      receipt.requestSha256,
      receipt.payloadSha256,
      MAX_WITNESS_BYTES,
    ],
  );
  if (rows.length !== 1) return null;
  const row = observedSchema.safeParse(rows[0]);
  if (
    !row.success ||
    row.data.confirmedAt < receipt.insertedAt ||
    row.data.confirmedAt >= target.from
  )
    return null;
  return row.data;
}

async function observeWithFreshSession(
  pool: Pool,
  creatorId: string,
  receipt: Receipt,
  signal: AbortSignal,
): Promise<ForecastCommitQualification> {
  const client = await pool.connect();
  let reusable = false;
  try {
    signal.throwIfAborted();
    if (client.getTransactionStatus() !== "I")
      return { state: "unavailable", reason: "session-unavailable" };
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query(
      "SET LOCAL search_path = pg_catalog, pg_temp; SET LOCAL statement_timeout = '5000ms'; SET LOCAL lock_timeout = '2000ms'",
    );
    if (client.getTransactionStatus() !== "T")
      return { state: "unavailable", reason: "session-unavailable" };
    const observed = await readReceipt(client, creatorId, receipt);
    const finished = await client.query("ROLLBACK");
    reusable = finished.command === "ROLLBACK" && client.getTransactionStatus() === "I";
    signal.throwIfAborted();
    if (!reusable) return { state: "unavailable", reason: "session-unavailable" };
    if (observed === null) return { state: "unavailable", reason: "no-qualifying-receipt" };
    return {
      state: "confirmed",
      proof: {
        definitionVersion: 1,
        basis: "independent-native-visibility-before-target",
        creatorId,
        ...receipt,
        ...observed,
      },
    };
  } finally {
    // Failed, borrowed or uncertain sessions leave the owned pool. PostgreSQL closes
    // any read transaction on disconnect. No pending query is returned for reuse.
    client.release(!reusable);
  }
}

/**
 * Internal observation only. A trusted server caller supplies the authenticated creator
 * and exact expected values from the forecast insert. The pool belongs to the same
 * primary and private installation. A proof does not grant report or payload access.
 */
export async function qualifyForecastCommit(
  pool: Pool,
  creator: PermSetUser,
  expected: ForecastCommitExpectation,
  signal: AbortSignal,
): Promise<ForecastCommitQualification> {
  signal.throwIfAborted();
  if (!isBoundedPool(pool)) return { state: "unavailable", reason: "session-unavailable" };
  const actorId = uuid.safeParse(creator.id);
  if (!creator.isActive || !actorId.success)
    return { state: "unavailable", reason: "no-qualifying-receipt" };
  const receipt = receiptSchema.safeParse(expected);
  if (!receipt.success || !validFrame(receipt.data))
    return { state: "unavailable", reason: "invalid-expectation" };
  try {
    return await observeWithFreshSession(pool, actorId.data, receipt.data, signal);
  } catch {
    signal.throwIfAborted();
    return { state: "unavailable", reason: "read-unavailable" };
  }
}
