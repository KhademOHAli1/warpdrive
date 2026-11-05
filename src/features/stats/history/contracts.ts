import { z } from "zod";

export const ANALYTICS_HISTORY_SCHEMA_VERSION = 2;
export const HISTORY_OBSERVATION_BASIS = "database-row-observation-v1";
const MAX_PG_BIGINT = 9_223_372_036_854_775_807n;
const MAX_PG_XID8 = 18_446_744_073_709_551_615n;
// PostgreSQL emits canonical UUID text even when a legacy value has non-RFC variant bits.
export const historyUuid = z.guid();
const instant = z.string().datetime({ offset: true });

function isBoundedPositiveInteger(value: string, maximum: bigint): boolean {
  return (
    value.length <= maximum.toString().length &&
    /^[1-9]\d*$/.test(value) &&
    BigInt(value) <= maximum
  );
}

function isCanonicalSnapshotWitness(value: string): boolean {
  const parts = value.split(":");
  if (parts.length !== 3) return false;
  const minimumText = parts[0] ?? "",
    maximumText = parts[1] ?? "",
    activeText = parts[2] ?? "";
  if (
    !isBoundedPositiveInteger(minimumText, MAX_PG_XID8) ||
    !isBoundedPositiveInteger(maximumText, MAX_PG_XID8)
  )
    return false;
  const minimum = BigInt(minimumText),
    maximum = BigInt(maximumText);
  if (minimum > maximum) return false;
  let previous: bigint | null = null;
  for (const item of activeText === "" ? [] : activeText.split(",")) {
    if (!isBoundedPositiveInteger(item, MAX_PG_XID8)) return false;
    const transaction = BigInt(item);
    if (
      transaction < minimum ||
      transaction >= maximum ||
      (previous !== null && transaction <= previous)
    )
      return false;
    previous = transaction;
  }
  return true;
}

// Canonical native pg_snapshot output; syntactic validity still grants no source authority.
export const historyVisibilitySnapshot = z.string().refine(isCanonicalSnapshotWitness);

// Native bigint and text are lossless. A JavaScript number is deliberately not accepted.
export const historyOrdinal = z
  .union([
    z.bigint().positive().max(MAX_PG_BIGINT),
    z.string().refine((value) => isBoundedPositiveInteger(value, MAX_PG_BIGINT)),
  ])
  .transform(String);

export const historyEntityKind = z.enum(["deal", "stage", "pipeline"]);
export const historyEventKind = z.enum(["baseline", "insert", "update", "delete"]);
export const historyState = z.record(z.string(), z.json());
export type HistoryState = z.infer<typeof historyState>;

const pgInt = z.number().int().min(-2_147_483_648).max(2_147_483_647);
const capturedDealProjection = z.strictObject({
  status: z.enum(["open", "won", "lost"]),
  value: z
    .string()
    .regex(/^-?\d{1,14}(\.\d{1,4})?$/)
    .nullable(),
  currency: z.string().min(1),
  ownerId: historyUuid,
  pipelineId: historyUuid,
  stageId: historyUuid,
  wonTime: instant.nullable(),
  lostTime: instant.nullable(),
  expectedCloseDate: z.iso.date().nullable(),
  archivedAt: instant.nullable(),
  deletedAt: instant.nullable(),
  visibilityLevel: z.enum(["owner", "group", "all"]),
  visibilityGroupId: historyUuid.nullable(),
  visibleToUserIds: z.array(historyUuid),
});

// Names are part of the historical stage definition required for exact replay.
export const capturedStageProjection = z.strictObject({
  name: z.string(),
  order: pgInt,
  pipelineId: historyUuid,
  rottingDays: pgInt.nullable(),
});

const projectionByEntity = {
  deal: capturedDealProjection,
  stage: capturedStageProjection,
  pipeline: z.strictObject({
    visibilityGroupId: historyUuid.nullable(),
    isArchived: z.boolean(),
  }),
};

export const analyticsHistoryEvent = z
  .strictObject({
    eventId: historyUuid,
    ordinal: historyOrdinal,
    activationId: historyUuid,
    entityKind: historyEntityKind,
    entityId: historyUuid,
    incarnationId: historyUuid,
    eventKind: historyEventKind,
    schemaVersion: z.literal(ANALYTICS_HISTORY_SCHEMA_VERSION),
    transactionId: z.string().refine((value) => isBoundedPositiveInteger(value, MAX_PG_XID8)),
    // Produced by PostgreSQL, not a client-supplied claim of snapshot authority.
    observationSnapshot: historyVisibilitySnapshot,
    observedAt: instant,
    beforeState: historyState.nullable(),
    afterState: historyState.nullable(),
    beforeWriteVersion: historyUuid.nullable(),
    afterWriteVersion: historyUuid.nullable(),
    actorId: historyUuid.nullable(),
    commandId: z.string().min(1).nullable(),
  })
  .superRefine((event, context) => {
    const needsBefore = event.eventKind === "update" || event.eventKind === "delete";
    const needsAfter = event.eventKind !== "delete";
    if (
      (event.beforeState !== null) !== needsBefore ||
      (event.afterState !== null) !== needsAfter
    ) {
      context.addIssue({
        code: "custom",
        path: ["eventKind"],
        message: "Event/state shape mismatch",
      });
    }
    const projection = projectionByEntity[event.entityKind];
    for (const [key, state] of [
      ["beforeState", event.beforeState],
      ["afterState", event.afterState],
    ] as const) {
      if (state === null) continue;
      const parsed = projection.safeParse(state);
      if (!parsed.success)
        context.addIssue({
          code: "custom",
          path: [key],
          message: "Unsupported history projection",
        });
    }
  });

export type AnalyticsHistoryEvent = z.infer<typeof analyticsHistoryEvent>;

export const historyActivation = z.strictObject({
  activationId: historyUuid,
  schemaVersion: z.literal(ANALYTICS_HISTORY_SCHEMA_VERSION),
  activatedAt: instant,
  captureSemantics: z.literal(HISTORY_OBSERVATION_BASIS),
});
export type HistoryActivation = z.infer<typeof historyActivation>;

export const HISTORY_CONTRACT_LIMITATIONS = {
  ordering:
    "An ordinal is deterministic row-write ordering, not transaction commit ordering or a visibility watermark.",
  snapshot:
    "Readers must preserve database snapshot visibility or an explicit constituent event/revision set; a maximum ordinal alone cannot exclude late commits.",
  authority:
    "Parsing and folding grant no access. The server must reapply current viewer authority and the permitted incarnation before returning summaries, records or exports.",
  legacy:
    "A baseline observes a current row at capture activation. It supplies no earlier creation, stage entry, completed stay or historical inventory.",
  actor:
    "Actor and command remain unknown until a trusted transactional adapter supplies them. Owner is not actor evidence.",
  time: "observedAt records database row observation, not commit time or an asserted imported business timestamp.",
} as const;
