import { z } from "zod";
import { type AnalyticsHistoryEvent, analyticsHistoryEvent, historyUuid } from "./contracts";
import {
  foldTransactionHistory,
  type HistoryFoldResult,
  sameHistoryState,
  type TransactionHistoryChange,
} from "./fold";

export const MAX_STAGE_DEFINITION_EVENTS = 5_000;

const pgInt = z.number().int().min(-2_147_483_648).max(2_147_483_647);
const xid8 = z
  .string()
  .refine(
    (value) =>
      value.length <= 20 &&
      /^[1-9]\d*$/.test(value) &&
      BigInt(value) <= 18_446_744_073_709_551_615n,
  );

// Keep the state shape aligned with analytics_project_stage, including signed database integers.
const stageProjection = z.strictObject({
  name: z.string(),
  order: pgInt,
  pipelineId: historyUuid,
  rottingDays: pgInt.nullable(),
});

const stageDefinitionScope = z.strictObject({
  activationId: historyUuid,
  stageId: historyUuid,
  pipelineId: historyUuid,
  authorizedIncarnationId: historyUuid,
  anchorTransactionId: xid8,
  ownTransactionPolicy: z.enum(["include-final-own-transaction", "exclude-own-transaction"]),
});

export type StageDefinitionScope = z.infer<typeof stageDefinitionScope>;
export type StageDefinition = z.infer<typeof stageProjection>;

type FoldFailure = Extract<HistoryFoldResult, { ok: false }>;
type Failure = {
  ok: false;
  reason:
    | FoldFailure["reason"]
    | "invalid-scope"
    | "incompatible-event-scope"
    | "invalid-stage-projection"
    | "bounded-limit"
    | "missing-definition"
    | "deleted-definition"
    | "incompatible-incarnation"
    | "incompatible-pipeline";
};

export type StageDefinitionSelection =
  | Failure
  | {
      ok: true;
      activationId: string;
      stageId: string;
      incarnationId: string;
      definition: StageDefinition;
      source: {
        membership: "snapshot-visible" | "anchor-transaction-final";
        evidence: TransactionHistoryChange["evidence"];
        firstOrdinal: string;
        lastOrdinal: string;
        eventIds: string[];
      };
    };

function isExpectedStage(event: AnalyticsHistoryEvent, scope: StageDefinitionScope): boolean {
  return (
    event.entityKind === "stage" &&
    event.entityId === scope.stageId &&
    event.activationId === scope.activationId
  );
}

function hasValidProjection(event: AnalyticsHistoryEvent): boolean {
  return (
    (event.beforeState === null || stageProjection.safeParse(event.beforeState).success) &&
    (event.afterState === null || stageProjection.safeParse(event.afterState).success)
  );
}

// Fold can join null→state after state→null in a single transaction. Capture must give that
// reinsert a new incarnation. Count distinct origin events before folding to enforce the rule.
function recordOrigin(event: AnalyticsHistoryEvent, origins: Map<string, string>): boolean {
  if (event.eventKind !== "baseline" && event.eventKind !== "insert") return true;
  const previous = origins.get(event.incarnationId);
  if (previous !== undefined) return previous === event.eventId;
  origins.set(event.incarnationId, event.eventId);
  return true;
}

function prepareEvents(
  rows: readonly unknown[],
  scope: StageDefinitionScope,
): Failure | { ok: true; events: AnalyticsHistoryEvent[] } {
  const origins = new Map<string, string>();
  const events: AnalyticsHistoryEvent[] = [];
  for (const row of rows) {
    const parsed = analyticsHistoryEvent.safeParse(row);
    if (!parsed.success) return { ok: false, reason: "invalid-event" };
    const event = parsed.data;
    if (!isExpectedStage(event, scope)) return { ok: false, reason: "incompatible-event-scope" };
    if (
      event.transactionId === scope.anchorTransactionId &&
      scope.ownTransactionPolicy === "exclude-own-transaction"
    )
      continue;
    if (!hasValidProjection(event)) return { ok: false, reason: "invalid-stage-projection" };
    if (!recordOrigin(event, origins)) return { ok: false, reason: "incomplete-chain" };
    events.push(event);
  }
  return { ok: true, events };
}

function follows(previous: TransactionHistoryChange, next: TransactionHistoryChange): boolean {
  if (
    next.evidence === "activation-baseline" ||
    BigInt(previous.lastOrdinal) >= BigInt(next.firstOrdinal)
  )
    return false;
  if (previous.incarnationId === next.incarnationId) {
    return previous.afterState !== null && sameHistoryState(previous.afterState, next.beforeState);
  }
  return previous.afterState === null && next.beforeState === null;
}

function hasCompleteChain(changes: readonly TransactionHistoryChange[]): boolean {
  const transactions = new Set<string>();
  let previous: TransactionHistoryChange | null = null;
  for (const change of changes) {
    if (previous === null ? change.beforeState !== null : !follows(previous, change)) return false;
    // A transaction can close and open multiple incarnations of this stage UUID. Its groups
    // must remain adjacent because another transaction cannot write the same stage between them.
    if (previous?.transactionId !== change.transactionId) {
      if (transactions.has(change.transactionId)) return false;
      transactions.add(change.transactionId);
    }
    previous = change;
  }
  return true;
}

function selectTip(
  latest: TransactionHistoryChange,
  scope: StageDefinitionScope,
): StageDefinitionSelection {
  if (latest.incarnationId !== scope.authorizedIncarnationId)
    return { ok: false, reason: "incompatible-incarnation" };
  if (latest.afterState === null) return { ok: false, reason: "deleted-definition" };
  const definition = stageProjection.safeParse(latest.afterState);
  if (!definition.success) return { ok: false, reason: "invalid-stage-projection" };
  if (definition.data.pipelineId !== scope.pipelineId)
    return { ok: false, reason: "incompatible-pipeline" };
  return {
    ok: true,
    activationId: latest.activationId,
    stageId: latest.entityId,
    incarnationId: latest.incarnationId,
    definition: definition.data,
    source: {
      membership:
        latest.transactionId === scope.anchorTransactionId
          ? "anchor-transaction-final"
          : "snapshot-visible",
      evidence: latest.evidence,
      firstOrdinal: latest.firstOrdinal,
      lastOrdinal: latest.lastOrdinal,
      eventIds: [...latest.eventIds],
    },
  };
}

/**
 * Internal selector. Supply a complete per-stage history for one activation, including every
 * incarnation and parent needed to validate the chain. PostgreSQL must apply
 * pg_visible_in_snapshot at the anchor to other top-level transactions. Optional anchor
 * transaction rows must be complete when the policy includes them.
 *
 * Membership, capture completeness and viewer authorization are caller proofs. A chain check
 * cannot detect an omitted suffix or entire prior lifetime. Apply expected parent/incarnation
 * to the selected tip rather than filtering away a visible replacement. Ordinals order the
 * supplied writes for this stage. They carry no cross-transaction visibility information.
 */
export function selectStageDefinition(
  rows: readonly unknown[],
  scope: StageDefinitionScope,
): StageDefinitionSelection {
  if (rows.length > MAX_STAGE_DEFINITION_EVENTS) return { ok: false, reason: "bounded-limit" };
  const parsed = stageDefinitionScope.safeParse(scope);
  if (!parsed.success) return { ok: false, reason: "invalid-scope" };
  const input = prepareEvents(rows, parsed.data);
  if (!input.ok) return input;
  const folded = foldTransactionHistory(input.events);
  if (!folded.ok) return folded;
  const latest = folded.changes.at(-1);
  if (latest === undefined) return { ok: false, reason: "missing-definition" };
  if (!hasCompleteChain(folded.changes)) return { ok: false, reason: "incomplete-chain" };
  return selectTip(latest, parsed.data);
}
