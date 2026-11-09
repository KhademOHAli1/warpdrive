import { z } from "zod";
import {
  type AnalyticsHistoryEvent,
  type HistoryState,
  historyOrdinal,
  historyUuid,
} from "./contracts";
import { foldTransactionHistory, sameHistoryState, type TransactionHistoryChange } from "./fold";

export const SETTLED_FORECAST_OUTCOME_DEFINITION = "first-net-observed-open-to-won-v1";
export const SETTLED_FORECAST_CAPTURE_POLICY = "post-target-native-barrier-v1";

const instant = z.iso.datetime({ precision: 6 });
export const savedOpenForecastMember = z.strictObject({
  dealId: historyUuid,
  incarnationId: historyUuid,
  tipOrdinal: historyOrdinal,
  status: z.literal("open"),
  currency: z.string().regex(/^[A-Z]{3}$/u),
  value: z
    .string()
    .regex(/^-?\d{1,14}(?:\.\d{1,4})?$/u)
    .nullable(),
  expectedCloseDate: z.iso.date().nullable(),
});
export type SavedOpenForecastMember = z.output<typeof savedOpenForecastMember>;

export interface OutcomeFence {
  from: string;
  toExclusive: string;
  predictionCutoff: string;
  observedAt: string;
  activationId: string;
  ownerId: string;
  pipelineId: string;
  currency: string;
}

interface CapturedRow {
  event: AnalyticsHistoryEvent;
  inPrediction: boolean;
}

export type SettledForecastOutcome =
  | { kind: "won"; eventId: string; occurredAt: string; observedAt: string; value: string | null }
  | {
      kind: "no-win";
      witnessId: string;
      stateAtEnd: "still-open" | "closed-lost" | "closed-won-before-target";
    };

const stateSchema = z.object({
  status: z.enum(["open", "lost", "won"]),
  ownerId: historyUuid,
  pipelineId: historyUuid,
  currency: z.string(),
  value: savedOpenForecastMember.shape.value,
  expectedCloseDate: savedOpenForecastMember.shape.expectedCloseDate,
  archivedAt: z.null(),
  deletedAt: z.null(),
});

function authorizedState(raw: HistoryState | null, fence: OutcomeFence) {
  const state = stateSchema.safeParse(raw);
  if (!state.success) return null;
  const { ownerId, pipelineId, currency } = state.data;
  return ownerId === fence.ownerId && pipelineId === fence.pipelineId && currency === fence.currency
    ? state.data
    : null;
}

function isAnchor(row: CapturedRow, member: SavedOpenForecastMember, fence: OutcomeFence): boolean {
  const { event } = row;
  const state = authorizedState(event.afterState, fence);
  return (
    row.inPrediction &&
    event.ordinal === member.tipOrdinal &&
    event.observedAt <= fence.predictionCutoff &&
    member.currency === fence.currency &&
    state !== null &&
    state.status === "open" &&
    state.value === member.value &&
    state.expectedCloseDate === member.expectedCloseDate
  );
}

function matchesRow(row: CapturedRow, member: SavedOpenForecastMember, fence: OutcomeFence) {
  const { event } = row;
  return (
    event.entityKind === "deal" &&
    event.entityId === member.dealId &&
    event.incarnationId === member.incarnationId &&
    event.activationId === fence.activationId &&
    instant.safeParse(event.observedAt).success &&
    event.observedAt <= fence.observedAt
  );
}

function completeSuffix(
  rows: readonly CapturedRow[],
  member: SavedOpenForecastMember,
  fence: OutcomeFence,
): AnalyticsHistoryEvent[] | null {
  const first = rows[0];
  if (first === undefined || !matchesRow(first, member, fence) || !isAnchor(first, member, fence))
    return null;

  let prior = first.event;
  const events: AnalyticsHistoryEvent[] = [];
  const transactions = new Set<string>();
  for (const row of rows.slice(1)) {
    const { event } = row;
    if (
      row.inPrediction ||
      !matchesRow(row, member, fence) ||
      event.eventKind !== "update" ||
      event.transactionId === first.event.transactionId ||
      BigInt(event.ordinal) <= BigInt(prior.ordinal) ||
      event.observedAt < prior.observedAt ||
      !sameHistoryState(prior.afterState, event.beforeState) ||
      authorizedState(event.afterState, fence) === null
    )
      return null;
    if (event.transactionId !== prior.transactionId && transactions.has(event.transactionId))
      return null;
    transactions.add(event.transactionId);
    events.push(event);
    prior = event;
  }
  return events;
}

type StateAtEnd = Extract<SettledForecastOutcome, { kind: "no-win" }>["stateAtEnd"];

function noWinState(status: "open" | "lost" | "won"): StateAtEnd {
  if (status === "open") return "still-open";
  return status === "lost" ? "closed-lost" : "closed-won-before-target";
}

type Won = Extract<SettledForecastOutcome, { kind: "won" }>;

function observedWin(change: TransactionHistoryChange, fence: OutcomeFence): Won | null {
  if (
    change.beforeState?.status !== "open" ||
    change.afterState?.status !== "won" ||
    change.observedTo < fence.from
  )
    return null;
  const eventId = change.eventIds.at(-1);
  const after = authorizedState(change.afterState, fence);
  if (eventId === undefined || after === null) return null;
  return {
    kind: "won",
    eventId,
    occurredAt: change.observedTo,
    observedAt: fence.observedAt,
    value: after.value,
  };
}

function crossesFence(from: string, to: string, fence: OutcomeFence): boolean {
  return (
    (from < fence.from && to >= fence.from) || (from < fence.toExclusive && to >= fence.toExclusive)
  );
}

function isDirectOutcomeCorrection(before: string, after: string): boolean {
  return before !== "open" && after !== "open" && before !== after;
}

function orderedFence({ predictionCutoff, from, toExclusive, observedAt }: OutcomeFence): boolean {
  return (
    [predictionCutoff, from, toExclusive, observedAt].every(
      (time) => instant.safeParse(time).success,
    ) &&
    predictionCutoff < from &&
    from < toExclusive &&
    toExclusive <= observedAt
  );
}

/**
 * Private classification of one exact saved-open deal. SQL establishes the native
 * anchor and complete suffix, live head, actor scope, and mature observation fence.
 * Captured wall-clock row observations define period membership.
 */
export function classifySettledForecastOutcome(
  rows: readonly CapturedRow[],
  member: SavedOpenForecastMember,
  fence: OutcomeFence,
): SettledForecastOutcome | null {
  if (!orderedFence(fence)) return null;
  const suffix = completeSuffix(rows, member, fence);
  if (suffix === null) return null;
  const folded = foldTransactionHistory(suffix);
  if (!folded.ok || folded.duplicateDeliveries !== 0) return null;
  let stateAtEnd: StateAtEnd = "still-open";
  let witnessId = rows[0]?.event.eventId;
  let win: Won | null = null;
  for (const change of folded.changes) {
    if (change.observedFrom >= fence.toExclusive) break;
    if (crossesFence(change.observedFrom, change.observedTo, fence)) return null;
    const after = authorizedState(change.afterState, fence);
    const before = authorizedState(change.beforeState, fence);
    if (after === null || before === null) return null;
    // A direct won/lost correction requires a distinct restatement policy.
    if (isDirectOutcomeCorrection(before.status, after.status)) return null;
    win ??= observedWin(change, fence);
    stateAtEnd = noWinState(after.status);
    witnessId = change.eventIds.at(-1);
  }
  return win ?? (witnessId === undefined ? null : { kind: "no-win", witnessId, stateAtEnd });
}
