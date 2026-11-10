import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { z } from "zod";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import {
  type AnalyticsInputAdmission,
  type AnalyticsInputReceipt,
  canonicalAnalyticsInputEvent,
  MAX_PRIOR_ANALYTICS_INPUT_RECEIPTS,
  planAnalyticsInputAdmission,
} from "./analyticsInputAdmission";
import {
  type AnalyticsInputBatch,
  type AnalyticsSourceEvent,
  analyticsInputBatch,
  analyticsSourceProvenance,
} from "./analyticsInputContracts";

const MAX_EVENT_BYTES = 32_768;
const MAX_BATCH_BYTES = 4_194_304;
const sourceId = analyticsSourceProvenance.shape.producer;
const authoritySchema = z.strictObject({
  producer: sourceId,
  registrationRef: sourceId,
  authenticationRef: sourceId,
  principal: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("interactive-user"), userId: z.uuid() }),
    z.strictObject({ kind: z.literal("service-adapter"), principalRef: sourceId }),
  ]),
});

type Authority = z.output<typeof authoritySchema>;
type Family = AnalyticsSourceEvent["kind"];
type Plan = Extract<AnalyticsInputAdmission, { state: "planned" }>;
declare const verifiedGovernedInput: unique symbol;

/**
 * The trusted server adapter must own this type and private brand at integration.
 * It issues the envelope after fresh authentication and source/link policy checks
 * for this exact batch. This repository verifies configured database grants.
 */
export interface AuthenticatedGovernedInput {
  readonly [verifiedGovernedInput]: true;
  readonly authority: Authority;
  readonly batch: AnalyticsInputBatch;
}

interface AcceptedLine {
  inputIndex: number;
  eventId: string;
  revision: number;
  fingerprint: AnalyticsInputReceipt["fingerprint"];
  disposition: "appended" | "exact-retry";
}

type Unavailable =
  | {
      state: "unavailable";
      reason:
        | "invalid-delivery"
        | "authority-unavailable"
        | "payload-limit"
        | "transaction-unavailable"
        | "storage-unavailable";
    }
  | { state: "unavailable"; reason: "commit-unconfirmed"; admissionId: string };

export type GovernedInputWrite =
  | { state: "committed"; admissionId: string; admittedAt: string; lines: AcceptedLine[] }
  | Extract<AnalyticsInputAdmission, { state: "rejected" }>
  | Unavailable;

interface Delivery {
  authority: Authority;
  actorId: string | null;
  principalRef: string;
  batch: AnalyticsInputBatch;
  canonicalPayloads: string[];
  families: Family[];
}

function hasPgText(value: unknown): boolean {
  if (typeof value === "string")
    return !value.includes("\0") && Buffer.from(value, "utf8").toString("utf8") === value;
  if (value === null || typeof value !== "object") return true;
  return Object.values(value).every(hasPgText);
}

function encodePayloads(batch: AnalyticsInputBatch): string[] | null {
  const encoded: string[] = [];
  let totalBytes = 0;
  for (const event of batch.events) {
    const canonical = canonicalAnalyticsInputEvent(event);
    const bytes = Buffer.byteLength(canonical, "utf8");
    totalBytes += bytes;
    if (bytes > MAX_EVENT_BYTES || totalBytes > MAX_BATCH_BYTES) return null;
    encoded.push(canonical);
  }
  return encoded;
}

function prepareDelivery(
  input: AuthenticatedGovernedInput,
): { state: "ready"; delivery: Delivery } | Unavailable {
  const authority = authoritySchema.safeParse(input.authority);
  const batch = analyticsInputBatch.safeParse(input.batch);
  if (!authority.success || !batch.success || !hasPgText(authority.data) || !hasPgText(batch.data))
    return { state: "unavailable", reason: "invalid-delivery" };
  if (batch.data.events.some(({ provenance }) => provenance.producer !== authority.data.producer))
    return { state: "unavailable", reason: "authority-unavailable" };
  const canonicalPayloads = encodePayloads(batch.data);
  if (canonicalPayloads === null) return { state: "unavailable", reason: "payload-limit" };
  const principal = authority.data.principal;
  const actorId = principal.kind === "interactive-user" ? principal.userId.toLowerCase() : null;
  const principalRef =
    principal.kind === "service-adapter" ? principal.principalRef : principal.userId.toLowerCase();
  return {
    state: "ready",
    delivery: {
      authority: authority.data,
      actorId,
      principalRef,
      batch: batch.data,
      canonicalPayloads,
      families: [...new Set(batch.data.events.map(({ kind }) => kind))],
    },
  };
}

interface Grant {
  id: string;
  kind: Family;
  policyVersion: string;
}

async function lockAuthority(
  client: PoolClient,
  delivery: Delivery,
): Promise<Map<Family, Grant> | null> {
  const { authority, actorId, principalRef, families } = delivery;
  const producer = await client.query(
    `SELECT 1 FROM public.analytics_input_producers
     WHERE producer = $1 AND registration_ref = $2 AND enabled
     FOR UPDATE`,
    [authority.producer, authority.registrationRef],
  );
  if (producer.rowCount !== 1) return null;

  if (actorId !== null) {
    const user = await client.query(
      "SELECT 1 FROM public.users WHERE id = $1::uuid AND is_active FOR SHARE",
      [actorId],
    );
    if (user.rowCount !== 1) return null;
  }

  const { rows } = await client.query<Grant>(
    `SELECT grant_id::text AS id, event_family::text AS kind, policy_version AS "policyVersion"
     FROM public.analytics_input_grants
     WHERE producer = $1 AND principal_kind = $2 AND principal_ref = $3
       AND event_family = ANY($4::text[]) AND revoked_at IS NULL
       AND valid_from <= pg_catalog.statement_timestamp()
       AND (expires_at IS NULL OR expires_at > pg_catalog.statement_timestamp())
     ORDER BY event_family, grant_id
     LIMIT $5 FOR SHARE`,
    [authority.producer, authority.principal.kind, principalRef, families, families.length + 1],
  );
  const byFamily = new Map(rows.map((grant) => [grant.kind, grant]));
  return rows.length === families.length && byFamily.size === families.length ? byFamily : null;
}

interface PriorRow {
  producer: string;
  sourceRecordId: string;
  eventId: string;
  revision: string;
  kind: Family;
  previousEventId: string | null;
  previousRevision: string | null;
  fingerprintVersion: string;
  digest: string;
}

function priorReceipt(row: PriorRow): unknown {
  const supersedes =
    row.previousEventId === null && row.previousRevision === null
      ? null
      : { eventId: row.previousEventId, revision: Number(row.previousRevision) };
  return {
    producer: row.producer,
    sourceRecordId: row.sourceRecordId,
    eventId: row.eventId,
    revision: Number(row.revision),
    kind: row.kind,
    supersedes,
    fingerprint: { version: row.fingerprintVersion, digest: row.digest },
  };
}

async function readPrior(client: PoolClient, delivery: Delivery): Promise<unknown[]> {
  const sourceRecords = new Set<string>();
  const eventKeys = new Set<string>();
  for (const { provenance } of delivery.batch.events) {
    sourceRecords.add(provenance.sourceRecordId);
    eventKeys.add(provenance.eventId);
    if (provenance.supersedes !== undefined) eventKeys.add(provenance.supersedes.eventId);
  }
  // A key hit on another source record also requires that record's complete chain.
  const { rows } = await client.query<PriorRow>(
    `WITH requested_records AS MATERIALIZED (
       SELECT pg_catalog.unnest($2::text[]) COLLATE pg_catalog."C" AS id
       UNION
       SELECT source_record_id::text FROM public.analytics_input_events
       WHERE producer = $1 AND event_id = ANY($3::text[])
     )
     SELECT e.producer, e.source_record_id AS "sourceRecordId", e.event_id AS "eventId",
       e.revision::text AS revision, e.event_family::text AS kind,
       e.supersedes_event_id AS "previousEventId", e.supersedes_revision::text AS "previousRevision",
       e.fingerprint_version AS "fingerprintVersion", pg_catalog.encode(e.fingerprint_sha256, 'hex') AS digest
     FROM requested_records r
     JOIN public.analytics_input_events e ON e.producer = $1 AND e.source_record_id = r.id
     LIMIT $4`,
    [
      delivery.authority.producer,
      [...sourceRecords],
      [...eventKeys],
      MAX_PRIOR_ANALYTICS_INPUT_RECEIPTS + 1,
    ],
  );
  return rows.map(priorReceipt);
}

interface AdmissionRow {
  input_index: number;
  event_id: string;
  source_record_id: string;
  revision: number;
  event_family: Family;
  grant_id: string;
  policy_version: string;
  fingerprint_version: AnalyticsInputReceipt["fingerprint"]["version"];
  digest: string;
  canonical_payload: string;
  appended: boolean;
}

const admissionRecordset = `
  input_index smallint, event_id text, source_record_id text, revision bigint,
  event_family text, grant_id uuid, policy_version text, fingerprint_version text,
  digest text, canonical_payload text, appended boolean`;

function plannedRows(delivery: Delivery, grants: Map<Family, Grant>, plan: Plan): AdmissionRow[] {
  return [...plan.appends, ...plan.retries].map((item) => {
    const { inputIndex, receipt } = item;
    const grant = grants.get(receipt.kind);
    const payload = delivery.canonicalPayloads[inputIndex];
    if (grant === undefined || payload === undefined)
      throw new AppError(ERROR_IDS.DB_WRITE_FAILED, "Governed input plan has no prepared line");
    return {
      input_index: inputIndex,
      event_id: receipt.eventId,
      source_record_id: receipt.sourceRecordId,
      revision: receipt.revision,
      event_family: receipt.kind,
      grant_id: grant.id,
      policy_version: grant.policyVersion,
      fingerprint_version: receipt.fingerprint.version,
      digest: receipt.fingerprint.digest,
      canonical_payload: payload,
      appended: "event" in item,
    };
  });
}

interface PreparedReceipt {
  admissionId: string;
  delivery: Delivery;
  rows: AdmissionRow[];
  rowsJson: string;
}

function headerParams({ admissionId, delivery }: PreparedReceipt) {
  return [
    admissionId,
    delivery.authority.producer,
    delivery.batch.batchId,
    delivery.batch.contractVersion,
    delivery.authority.principal.kind,
    delivery.principalRef,
    delivery.actorId,
    delivery.authority.authenticationRef,
    delivery.batch.events.length,
  ];
}

async function persistAdmission(client: PoolClient, receipt: PreparedReceipt) {
  const { admissionId, delivery, rowsJson } = receipt;
  await client.query(
    `INSERT INTO public.analytics_input_admissions (
       admission_id, producer, batch_id, contract_version, principal_kind, principal_ref,
       actor_user_id, authentication_ref, input_count
     ) VALUES ($1::uuid,$2,$3,$4,$5,$6,$7::uuid,$8,$9)`,
    headerParams(receipt),
  );
  await client.query(
    `INSERT INTO public.analytics_input_events (
       producer, event_id, source_record_id, revision, event_family, supersedes_event_id,
       supersedes_revision, fingerprint_version, fingerprint_sha256, canonical_payload,
       payload, first_admission_id, first_input_index
     )
     SELECT $1::public.analytics_input_source_id, x.event_id, x.source_record_id, x.revision,
       x.event_family, x.canonical_payload::jsonb #>> '{provenance,supersedes,eventId}',
       (x.canonical_payload::jsonb #>> '{provenance,supersedes,revision}')::bigint,
       x.fingerprint_version, pg_catalog.decode(x.digest, 'hex'), x.canonical_payload,
       x.canonical_payload::jsonb, $2::uuid, x.input_index
     FROM pg_catalog.jsonb_to_recordset($3::jsonb) AS x(${admissionRecordset})
     WHERE x.appended
     ORDER BY x.source_record_id COLLATE pg_catalog."C", x.revision`,
    [delivery.authority.producer, admissionId, rowsJson],
  );
  await client.query(
    `INSERT INTO public.analytics_input_admission_items (
       admission_id, input_index, input_count, producer, principal_kind, principal_ref,
       grant_id, policy_version, source_record_id, revision, event_id, event_family
     )
     SELECT $1::uuid, x.input_index, $2::smallint, $3::public.analytics_input_source_id,
       $4::text, $5::public.analytics_input_source_id, x.grant_id, x.policy_version,
       x.source_record_id, x.revision, x.event_id, x.event_family
     FROM pg_catalog.jsonb_to_recordset($6::jsonb) AS x(${admissionRecordset})
     ORDER BY x.input_index`,
    [
      admissionId,
      delivery.batch.events.length,
      delivery.authority.producer,
      delivery.authority.principal.kind,
      delivery.principalRef,
      rowsJson,
    ],
  );
}

async function verifyReceipt(client: PoolClient, receipt: PreparedReceipt): Promise<string | null> {
  const result = await client.query<{ admittedAt: string }>(
    `SELECT pg_catalog.to_char(a.admitted_at AT TIME ZONE 'UTC',
       'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "admittedAt"
     FROM public.analytics_input_admissions a
     JOIN public.analytics_input_admission_items i ON i.admission_id = a.admission_id
     JOIN public.analytics_input_events e ON e.producer = i.producer AND e.event_id = i.event_id
     JOIN pg_catalog.jsonb_to_recordset($10::jsonb) AS x(${admissionRecordset})
       ON x.input_index = i.input_index
     WHERE a.admission_id = $1::uuid AND a.producer = $2 AND a.batch_id = $3
       AND a.contract_version = $4 AND a.principal_kind = $5 AND a.principal_ref = $6
       AND a.actor_user_id IS NOT DISTINCT FROM $7::uuid AND a.authentication_ref = $8
       AND a.input_count = $9 AND i.input_count = a.input_count AND i.producer = a.producer
       AND i.principal_kind = a.principal_kind AND i.principal_ref = a.principal_ref
       AND i.grant_id = x.grant_id AND i.policy_version = x.policy_version
       AND i.source_record_id = x.source_record_id AND i.revision = x.revision
       AND i.event_id = x.event_id AND i.event_family = x.event_family
       AND e.source_record_id = i.source_record_id AND e.revision = i.revision
       AND e.event_family = i.event_family AND e.fingerprint_version = x.fingerprint_version
       AND e.fingerprint_sha256 = pg_catalog.decode(x.digest, 'hex')
       AND e.canonical_payload COLLATE pg_catalog."C" = x.canonical_payload COLLATE pg_catalog."C"
       AND (e.first_admission_id = a.admission_id) = x.appended
       AND (NOT x.appended OR e.first_input_index = x.input_index)
     GROUP BY a.admission_id
     HAVING pg_catalog.count(*) = a.input_count`,
    [...headerParams(receipt), receipt.rowsJson],
  );
  return result.rows[0]?.admittedAt ?? null;
}

type PreparedCommit =
  | { state: "prepared"; receipt: PreparedReceipt; admittedAt: string }
  | Extract<GovernedInputWrite, { state: "rejected" | "unavailable" }>;

async function prepareCommit(
  client: PoolClient,
  admissionId: string,
  delivery: Delivery,
  signal: AbortSignal,
): Promise<PreparedCommit> {
  const grants = await lockAuthority(client, delivery);
  if (grants === null) return { state: "unavailable", reason: "authority-unavailable" };
  signal.throwIfAborted();
  const receipts = await readPrior(client, delivery);
  const plan = planAnalyticsInputAdmission(delivery.batch, { completeness: "complete", receipts });
  if (plan.state === "rejected") return plan;
  signal.throwIfAborted();

  const rows = plannedRows(delivery, grants, plan).sort((a, b) => a.input_index - b.input_index);
  const receipt = { admissionId, delivery, rows, rowsJson: JSON.stringify(rows) };
  await persistAdmission(client, receipt);
  const admittedAt = await verifyReceipt(client, receipt);
  if (admittedAt === null)
    throw new AppError(ERROR_IDS.DB_WRITE_FAILED, "Governed input receipt disagrees with plan");
  return { state: "prepared", receipt, admittedAt };
}

async function confirmCommit(client: PoolClient, receipt: PreparedReceipt): Promise<string | null> {
  const commit = await client.query("COMMIT");
  if (commit.command !== "COMMIT") return null;

  // The write's SET LOCAL timeout ended at COMMIT. Bound the fresh confirmation too.
  await client.query(
    "BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY; SET LOCAL statement_timeout = '5000ms'",
  );
  const admittedAt = await verifyReceipt(client, receipt);
  await client.query("ROLLBACK");
  return admittedAt;
}

/** Internal custody boundary. Receipts confer neither source qualification nor report permission. */
export async function writeGovernedInput(
  pool: Pool,
  input: AuthenticatedGovernedInput,
  signal: AbortSignal,
): Promise<GovernedInputWrite> {
  signal.throwIfAborted();
  if (!(pool instanceof Pool)) return { state: "unavailable", reason: "transaction-unavailable" };
  const prepared = prepareDelivery(input);
  if (prepared.state !== "ready") return prepared;

  const admissionId = randomUUID();
  let client: PoolClient | undefined;
  let commitAttempted = false;
  let discard = false;
  try {
    client = await pool.connect();
    signal.throwIfAborted();
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE");
    await client.query(
      "SET LOCAL statement_timeout = '5000ms'; SET LOCAL lock_timeout = '2000ms'; SET LOCAL synchronous_commit = on",
    );
    const pending = await prepareCommit(client, admissionId, prepared.delivery, signal);
    if (pending.state !== "prepared") {
      await client.query("ROLLBACK");
      return pending;
    }
    signal.throwIfAborted();
    // Late cancellation cannot turn an attempted commit into a rollback claim.
    commitAttempted = true;
    const admittedAt = await confirmCommit(client, pending.receipt);
    if (admittedAt !== pending.admittedAt)
      throw new AppError(ERROR_IDS.DB_READ_FAILED, "Governed input commit could not be verified");
    return {
      state: "committed",
      admissionId,
      admittedAt,
      lines: pending.receipt.rows.map((row) => ({
        inputIndex: row.input_index,
        eventId: row.event_id,
        revision: row.revision,
        fingerprint: { version: row.fingerprint_version, digest: row.digest },
        disposition: row.appended ? "appended" : "exact-retry",
      })),
    };
  } catch {
    if (commitAttempted) {
      discard = true;
      return { state: "unavailable", reason: "commit-unconfirmed", admissionId };
    }
    try {
      await client?.query("ROLLBACK");
    } catch {
      discard = true;
    }
    signal.throwIfAborted();
    return { state: "unavailable", reason: "storage-unavailable" };
  } finally {
    client?.release(discard);
  }
}
