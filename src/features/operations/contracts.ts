import { z } from "zod";
import {
  EMAIL_NOTIFICATION_QUEUE,
  PGBOSS_QUEUE_ACTIVITY_REMINDER,
  PGBOSS_QUEUE_CALENDAR_REMINDER,
  PGBOSS_QUEUE_EMAIL_RECOVERY,
  PGBOSS_QUEUE_EMAIL_SEND,
  PGBOSS_QUEUE_EMAIL_SYNC,
  PGBOSS_QUEUE_FILE_REAPER,
  PGBOSS_QUEUE_IMPORT_COMMIT,
  PGBOSS_QUEUE_IMPORT_PREPARE,
  PGBOSS_QUEUE_IMPORT_UNDO,
  PGBOSS_QUEUE_IMPORT_VALIDATE,
  PGBOSS_QUEUE_RELEASE_CHECK,
  PGBOSS_QUEUE_REMINDER_OUTBOX,
  PGBOSS_QUEUE_WORKFLOW_RECONCILE,
  PGBOSS_QUEUE_WORKFLOW_RUN,
  PGBOSS_QUEUE_WORKFLOW_SCHEDULE,
} from "@/constants/jobNames";
import { err, ok, type Result } from "@/types/result";

export const OPERATIONS_MAX_BODY_BYTES = 64 * 1024;
export const OPERATIONS_MAX_BATCH_SIZE = 100;
export const OPERATIONS_MAX_CLOCK_SKEW_MS = 30_000;
export const OPERATIONS_MAX_TIMESTAMP_MS = 8_640_000_000_000_000;

// Adding a monitored feature/provider requires a reviewed registry/schema addition.
// No hostnames, paths, user identifiers or arbitrary diagnostic JSON are accepted.
export const operationsComponents = [
  "web",
  "worker",
  "realtime",
  "migrator",
  "newsletter_engine",
  "ingress",
] as const;
export const operationsFeatures = [
  "identity",
  "crm",
  "mailbox",
  "workflows",
  "newsletters",
  "files",
  "realtime",
] as const;
export const operationsProviders = [
  "smtp",
  "imap",
  "newsletter_delivery",
  "object_storage",
  "oidc",
] as const;
export const operationsQueues = [
  PGBOSS_QUEUE_ACTIVITY_REMINDER,
  PGBOSS_QUEUE_REMINDER_OUTBOX,
  PGBOSS_QUEUE_CALENDAR_REMINDER,
  PGBOSS_QUEUE_EMAIL_SYNC,
  PGBOSS_QUEUE_EMAIL_SEND,
  PGBOSS_QUEUE_EMAIL_RECOVERY,
  PGBOSS_QUEUE_FILE_REAPER,
  EMAIL_NOTIFICATION_QUEUE,
  PGBOSS_QUEUE_RELEASE_CHECK,
  PGBOSS_QUEUE_IMPORT_PREPARE,
  PGBOSS_QUEUE_IMPORT_VALIDATE,
  PGBOSS_QUEUE_IMPORT_COMMIT,
  PGBOSS_QUEUE_IMPORT_UNDO,
  PGBOSS_QUEUE_WORKFLOW_RUN,
  PGBOSS_QUEUE_WORKFLOW_RECONCILE,
  PGBOSS_QUEUE_WORKFLOW_SCHEDULE,
  "workflow-v2-run",
  "workflow-v2-reconcile",
  "newsletter-operations-monitor",
] as const;
export const operationsStates = ["healthy", "degraded", "failed", "unknown", "unchecked"] as const;
export type OperationsState = (typeof operationsStates)[number];
const reasonsByState = {
  healthy: ["ok"],
  degraded: ["queue_backlog", "retry_pending", "limited"],
  failed: [
    "unavailable",
    "check_failed",
    "identity_mismatch",
    "schema_mismatch",
    "operation_failed",
    "key_unavailable",
    "integrity_failed",
  ],
  unknown: ["not_reported", "sample_failed", "sample_timeout", "unsupported", "submission_unknown"],
  unchecked: ["not_checked", "not_configured"],
} as const satisfies Record<OperationsState, readonly string[]>;
const reason = z.enum([
  ...reasonsByState.healthy,
  ...reasonsByState.degraded,
  ...reasonsByState.failed,
  ...reasonsByState.unknown,
  ...reasonsByState.unchecked,
]);
const health = { state: z.enum(operationsStates), reason };
const timestamp = z.number().int().min(0).max(OPERATIONS_MAX_TIMESTAMP_MS);
const count = z.number().int().min(0).max(1_000_000_000);
const duration = z
  .number()
  .int()
  .min(0)
  .max(10 * 365 * 24 * 60 * 60 * 1000);
const fingerprint = z.string().regex(/^[0-9a-f]{64}$/);
const identity = z.uuid().regex(/^[0-9a-f-]+$/);

// These are inspected installed facts, never a latest-GitHub-release cache. Unknown
// identity remains explicit; a healthy HTTP probe cannot manufacture an image digest.
const installedIdentity = z.discriminatedUnion("evidence", [
  z.strictObject({ evidence: z.literal("unchecked") }),
  z.strictObject({
    evidence: z.literal("inspected"),
    imageDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    sourceRevision: z.string().regex(/^[0-9a-f]{40}$/),
    configurationSha256: fingerprint,
    schemaSha256: fingerprint.nullable(),
  }),
]);

export const operationsObservationSchema = z
  .discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("component"),
      component: z.enum(operationsComponents),
      ...health,
      installed: installedIdentity,
      latencyMs: z.number().int().min(0).max(300_000).nullable(),
    }),
    z.strictObject({ kind: z.literal("feature"), feature: z.enum(operationsFeatures), ...health }),
    z.strictObject({
      kind: z.literal("provider"),
      provider: z.enum(operationsProviders),
      ...health,
    }),
    z.strictObject({
      kind: z.literal("heartbeat"),
      component: z.enum(["web", "worker", "realtime", "newsletter_engine"]),
      processGeneration: identity,
      ...health,
      uptimeMs: duration.nullable(),
      activeCallbacks: count.nullable(),
    }),
    z.strictObject({
      kind: z.literal("queue"),
      queue: z.enum(operationsQueues),
      ...health,
      // Queue-cache values may not have been sampled. Null never means an empty queue.
      sampledAtMs: timestamp.nullable(),
      pendingCount: count.nullable(),
      activeCount: count.nullable(),
      readyOldestAgeMs: duration.nullable(),
      lastProgressAtMs: timestamp.nullable(),
    }),
    z.strictObject({
      kind: z.literal("observer"),
      observer: z.enum(["host_collector", "queue_sampler", "feature_sampler", "recovery_verifier"]),
      ...health,
    }),
    z.strictObject({
      kind: z.literal("recovery"),
      stage: z.enum(["backup_created", "offhost_received", "restore_tested"]),
      ...health,
      recoverySetId: identity.nullable(),
      completedAtMs: timestamp.nullable(),
      durationMs: duration.nullable(),
      bytes: z
        .number()
        .int()
        .min(0)
        .max(2 ** 50)
        .nullable(),
      encrypted: z.boolean().nullable(),
      contentSha256: fingerprint.nullable(),
    }),
  ])
  .refine(
    (observation) =>
      (reasonsByState[observation.state] as readonly string[]).includes(observation.reason),
    {
      message: "Unsupported operations state/reason combination",
    },
  )
  .refine(
    (observation) =>
      observation.kind !== "recovery" ||
      observation.state !== "healthy" ||
      (observation.recoverySetId !== null &&
        observation.completedAtMs !== null &&
        observation.contentSha256 !== null &&
        observation.encrypted === true),
    { message: "Successful recovery-stage evidence must identify an encrypted recovery set" },
  );
export type OperationsObservation = z.infer<typeof operationsObservationSchema>;

export function operationsObservationKey(observation: OperationsObservation): string {
  switch (observation.kind) {
    case "component":
      return `component:${observation.component}`;
    case "feature":
      return `feature:${observation.feature}`;
    case "provider":
      return `provider:${observation.provider}`;
    case "heartbeat":
      return `heartbeat:${observation.component}:${observation.processGeneration}`;
    case "queue":
      return `queue:${observation.queue}`;
    case "observer":
      return `observer:${observation.observer}`;
    case "recovery":
      return `recovery:${observation.stage}`;
  }
}

export const operationsBatchSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    generationId: identity,
    sequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    eventId: identity,
    observedAtMs: timestamp,
    observations: z.array(operationsObservationSchema).min(1).max(OPERATIONS_MAX_BATCH_SIZE),
  })
  .refine(
    (batch) =>
      new Set(batch.observations.map(operationsObservationKey)).size === batch.observations.length,
    { message: "Duplicate observation target in operations batch" },
  )
  .refine(
    (batch) =>
      batch.observations.every((observation) => {
        const latest = batch.observedAtMs + OPERATIONS_MAX_CLOCK_SKEW_MS;
        if (observation.kind === "queue")
          return (
            (observation.sampledAtMs === null || observation.sampledAtMs <= latest) &&
            (observation.lastProgressAtMs === null || observation.lastProgressAtMs <= latest)
          );
        return (
          observation.kind !== "recovery" ||
          observation.completedAtMs === null ||
          observation.completedAtMs <= latest
        );
      }),
    { message: "Observation metric time exceeds batch clock window" },
  );
export type OperationsBatch = z.infer<typeof operationsBatchSchema>;

// Supply only from authenticated collector enrollment, never from request body or
// a caller-provided workspace selector. Validation alone does not authenticate it.
export const operationsSourceBindingSchema = z.strictObject({
  installationId: identity,
  sourceId: identity,
  generationId: identity,
});
export type OperationsSourceBinding = z.infer<typeof operationsSourceBindingSchema>;
export interface BoundOperationsBatch {
  binding: OperationsSourceBinding;
  batch: OperationsBatch;
  receivedAtMs: number;
}
export type OperationsAdmissionError =
  | "invalid_source_binding"
  | "payload_too_large"
  | "invalid_payload"
  | "generation_mismatch"
  | "source_clock_ahead";

export function admitOperationsBatch(
  rawBody: string,
  serverBinding: OperationsSourceBinding,
  receivedAtMs: number,
): Result<BoundOperationsBatch, OperationsAdmissionError> {
  const binding = operationsSourceBindingSchema.safeParse(serverBinding);
  if (!binding.success || !timestamp.safeParse(receivedAtMs).success)
    return err("invalid_source_binding");
  if (
    rawBody.length > OPERATIONS_MAX_BODY_BYTES ||
    new TextEncoder().encode(rawBody).byteLength > OPERATIONS_MAX_BODY_BYTES
  )
    return err("payload_too_large");
  let raw: unknown;
  try {
    raw = JSON.parse(rawBody);
  } catch {
    return err("invalid_payload");
  }
  const parsed = operationsBatchSchema.safeParse(raw);
  if (!parsed.success) return err("invalid_payload");
  if (parsed.data.generationId !== binding.data.generationId) return err("generation_mismatch");
  if (parsed.data.observedAtMs > receivedAtMs + OPERATIONS_MAX_CLOCK_SKEW_MS)
    return err("source_clock_ahead");
  return ok({ binding: binding.data, batch: parsed.data, receivedAtMs });
}

/** Persist both unique keys and the complete canonical payload fingerprint atomically.
 * These keys provide namespaces, not durable replay enforcement or a signature.
 */
export function operationsReceiptKeys(value: BoundOperationsBatch): {
  sequenceKey: string;
  eventKey: string;
} {
  const source = `${value.binding.installationId}/${value.binding.sourceId}`;
  return {
    sequenceKey: `${source}/${value.batch.generationId}/${value.batch.sequence}`,
    eventKey: `${source}/${value.batch.eventId}`,
  };
}
