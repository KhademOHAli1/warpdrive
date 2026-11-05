import { type AnalyticsHistoryEvent, analyticsHistoryEvent, type HistoryState } from "./contracts";

export interface TransactionHistoryChange {
  entityKind: AnalyticsHistoryEvent["entityKind"];
  entityId: string;
  incarnationId: string;
  activationId: string;
  transactionId: string;
  firstOrdinal: string;
  lastOrdinal: string;
  observedFrom: string;
  observedTo: string;
  eventIds: string[];
  beforeState: HistoryState | null;
  afterState: HistoryState | null;
  evidence: "activation-baseline" | "observed-row-change";
  netChange: boolean;
}

export type HistoryFoldResult =
  | { ok: true; changes: TransactionHistoryChange[]; duplicateDeliveries: number }
  | {
      ok: false;
      reason: "invalid-event" | "conflicting-event" | "conflicting-ordinal" | "incomplete-chain";
    };

type FoldFailure = Extract<HistoryFoldResult, { ok: false }>;

function compareKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

// JSONB key order is immaterial. Arrays and decimal strings retain their exact meaning.
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .sort(([a], [b]) => compareKeys(a, b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function sameHistoryState(left: HistoryState | null, right: HistoryState | null): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function uniqueEvents(
  input: readonly unknown[],
): FoldFailure | { ok: true; events: AnalyticsHistoryEvent[]; duplicateDeliveries: number } {
  const events = new Map<string, AnalyticsHistoryEvent>();
  const ordinals = new Map<string, string>();
  let duplicateDeliveries = 0;
  for (const raw of input) {
    const parsed = analyticsHistoryEvent.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: "invalid-event" };
    const event = parsed.data;
    const prior = events.get(event.eventId);
    if (prior !== undefined) {
      if (canonicalJson(prior) !== canonicalJson(event))
        return { ok: false, reason: "conflicting-event" };
      duplicateDeliveries += 1;
      continue;
    }
    const priorId = ordinals.get(event.ordinal);
    if (priorId !== undefined && priorId !== event.eventId)
      return { ok: false, reason: "conflicting-ordinal" };
    ordinals.set(event.ordinal, event.eventId);
    events.set(event.eventId, event);
  }
  return { ok: true, events: [...events.values()], duplicateDeliveries };
}

function initialChange(event: AnalyticsHistoryEvent): TransactionHistoryChange {
  return {
    entityKind: event.entityKind,
    entityId: event.entityId,
    incarnationId: event.incarnationId,
    activationId: event.activationId,
    transactionId: event.transactionId,
    firstOrdinal: event.ordinal,
    lastOrdinal: event.ordinal,
    observedFrom: event.observedAt,
    observedTo: event.observedAt,
    eventIds: [event.eventId],
    beforeState: event.beforeState,
    afterState: event.afterState,
    evidence: event.eventKind === "baseline" ? "activation-baseline" : "observed-row-change",
    netChange:
      event.eventKind !== "baseline" && !sameHistoryState(event.beforeState, event.afterState),
  };
}

function extendChange(prior: TransactionHistoryChange, event: AnalyticsHistoryEvent): boolean {
  if (event.eventKind === "baseline" || !sameHistoryState(prior.afterState, event.beforeState))
    return false;
  prior.afterState = event.afterState;
  prior.lastOrdinal = event.ordinal;
  prior.observedTo = event.observedAt;
  prior.eventIds.push(event.eventId);
  prior.netChange =
    prior.evidence !== "activation-baseline" &&
    !sameHistoryState(prior.beforeState, prior.afterState);
  return true;
}

function compareOrdinals(left: AnalyticsHistoryEvent, right: AnalyticsHistoryEvent): number {
  const a = BigInt(left.ordinal),
    b = BigInt(right.ordinal);
  return a < b ? -1 : a > b ? 1 : 0;
}

// Input must already be bounded, snapshot-filtered and viewer-authorized by the repository.
// Folding does not prove transaction visibility or grant access to any entity/incarnation.
export function foldTransactionHistory(input: readonly unknown[]): HistoryFoldResult {
  const parsed = uniqueEvents(input);
  if (!parsed.ok) return parsed;
  const ordered = parsed.events.sort(compareOrdinals);
  const groups = new Map<string, TransactionHistoryChange>();
  for (const event of ordered) {
    const key = JSON.stringify([
      event.activationId,
      event.entityKind,
      event.entityId,
      event.incarnationId,
      event.transactionId,
    ]);
    const prior = groups.get(key);
    if (prior === undefined) {
      groups.set(key, initialChange(event));
      continue;
    }
    if (!extendChange(prior, event)) return { ok: false, reason: "incomplete-chain" };
  }
  return {
    ok: true,
    changes: [...groups.values()],
    duplicateDeliveries: parsed.duplicateDeliveries,
  };
}
