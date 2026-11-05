import { Temporal } from "@js-temporal/polyfill";
import { HISTORY_OBSERVATION_BASIS, type HistoryState, historyOrdinal } from "./contracts";
import { sameHistoryState, type TransactionHistoryChange } from "./fold";

export const MAX_STAGE_EPISODE_CHANGES = 10_000;
export const MAX_STAGE_EPISODE_EVENT_WITNESSES = 100_000;

type DealStatus = "open" | "won" | "lost";
type EntryReason = "activation-baseline" | "insert" | "stage-change" | "pipeline-change" | "reopen";
type ExitReason = "stage-change" | "pipeline-change" | "won" | "lost";

export interface StageEpisodeWitness {
  firstOrdinal: string;
  lastOrdinal: string;
  eventIds: string[];
}

interface StageEpisodeEntry {
  pipelineId: string;
  stageId: string;
  enteredAt: string | null;
  observedFrom: string;
  entryReason: EntryReason;
  entryWitness: StageEpisodeWitness;
  leftCensored: boolean;
}

export interface CompletedStageStay extends StageEpisodeEntry {
  endedAt: string;
  exitReason: ExitReason;
  exitWitness: StageEpisodeWitness;
  rightCensored: false;
  // Null for a left-censored baseline. Never feed its observed lower bound into a completed-duration sample.
  durationNanoseconds: string | null;
  observedSpanNanoseconds: string;
}

export interface CurrentOpenStage extends StageEpisodeEntry {
  observationCutoff: string;
  rightCensored: true;
  // A baseline supplies a lower bound, not the age since an observed entry.
  ageNanoseconds: string | null;
  observedSpanNanoseconds: string;
}

export type StageEpisodeUnavailableReason =
  | "missing-history"
  | "bounded-limit"
  | "invalid-change"
  | "invalid-observation-time"
  | "invalid-entity-kind"
  | "mixed-entity"
  | "mixed-incarnation"
  | "mixed-activation"
  | "incomplete-state-chain"
  | "nonmonotonic-observation"
  | "cutoff-before-evidence"
  | "deleted-entity"
  | "deleted-state-in-history"
  | "archived-entity"
  | "archived-state-in-history";

export type StageEpisodesResult =
  | { ok: false; reason: StageEpisodeUnavailableReason }
  | {
      ok: true;
      entityId: string;
      incarnationId: string;
      activationId: string;
      observationBasis: typeof HISTORY_OBSERVATION_BASIS;
      observationCutoff: string;
      quality: "observed-from-insert" | "left-censored-at-activation";
      initialObservedStatus: DealStatus;
      finalObservedStatus: DealStatus;
      completedStays: CompletedStageStay[];
      currentOpenStage: CurrentOpenStage | null;
    };

interface StageState {
  status: DealStatus;
  stageId: string;
  pipelineId: string;
  deleted: boolean;
  archived: boolean;
}

interface PreparedChange {
  change: TransactionHistoryChange;
  before: StageState | null;
  after: StageState | null;
  firstOrdinal: bigint;
  lastOrdinal: bigint;
  observedFrom: bigint;
  observedTo: bigint;
}

type Failure = Extract<StageEpisodesResult, { ok: false }>;
type PreparedResult = Failure | { ok: true; changes: PreparedChange[]; cutoff: bigint };

function readStageState(state: HistoryState | null): StageState | null {
  if (state === null) return null;
  if (state.status !== "open" && state.status !== "won" && state.status !== "lost") return null;
  if (typeof state.stageId !== "string" || typeof state.pipelineId !== "string") return null;
  return {
    status: state.status,
    stageId: state.stageId,
    pipelineId: state.pipelineId,
    deleted: state.deletedAt !== undefined && state.deletedAt !== null,
    archived: state.archivedAt !== undefined && state.archivedAt !== null,
  };
}

function identityFailure(
  first: TransactionHistoryChange,
  change: TransactionHistoryChange,
): Failure | null {
  if (change.entityKind !== "deal") return { ok: false, reason: "invalid-entity-kind" };
  if (change.entityId !== first.entityId) return { ok: false, reason: "mixed-entity" };
  if (change.incarnationId !== first.incarnationId)
    return { ok: false, reason: "mixed-incarnation" };
  if (change.activationId !== first.activationId) return { ok: false, reason: "mixed-activation" };
  return null;
}

function prepareChange(change: TransactionHistoryChange, cutoff: bigint): Failure | PreparedChange {
  const first = historyOrdinal.safeParse(change.firstOrdinal);
  const last = historyOrdinal.safeParse(change.lastOrdinal);
  if (!first.success || !last.success || change.eventIds.length === 0)
    return { ok: false, reason: "invalid-change" };
  const firstOrdinal = BigInt(first.data),
    lastOrdinal = BigInt(last.data);
  if (firstOrdinal > lastOrdinal) return { ok: false, reason: "invalid-change" };
  const before = readStageState(change.beforeState),
    after = readStageState(change.afterState);
  if (
    (change.beforeState !== null && before === null) ||
    (change.afterState !== null && after === null)
  )
    return { ok: false, reason: "invalid-change" };
  try {
    const observedFrom = Temporal.Instant.from(change.observedFrom).epochNanoseconds;
    const observedTo = Temporal.Instant.from(change.observedTo).epochNanoseconds;
    if (observedFrom > observedTo) return { ok: false, reason: "nonmonotonic-observation" };
    if (observedTo > cutoff) return { ok: false, reason: "cutoff-before-evidence" };
    return { change, before, after, firstOrdinal, lastOrdinal, observedFrom, observedTo };
  } catch {
    return { ok: false, reason: "invalid-observation-time" };
  }
}

function linkFailure(previous: PreparedChange, current: PreparedChange): Failure | null {
  if (previous.lastOrdinal >= current.firstOrdinal) return { ok: false, reason: "invalid-change" };
  if (previous.observedTo > current.observedFrom)
    return { ok: false, reason: "nonmonotonic-observation" };
  if (!sameHistoryState(previous.change.afterState, current.change.beforeState))
    return { ok: false, reason: "incomplete-state-chain" };
  return null;
}

function inactiveFailure(change: PreparedChange, currentEntity: boolean): Failure | null {
  if (change.after === null || change.after.deleted) {
    return { ok: false, reason: currentEntity ? "deleted-entity" : "deleted-state-in-history" };
  }
  if (change.after.archived) {
    return { ok: false, reason: currentEntity ? "archived-entity" : "archived-state-in-history" };
  }
  return null;
}

function sequenceFailure(changes: PreparedChange[]): Failure | null {
  const first = changes[0],
    last = changes.at(-1);
  if (first === undefined || last === undefined) return { ok: false, reason: "missing-history" };
  if (first.change.beforeState !== null) return { ok: false, reason: "incomplete-state-chain" };
  const inactiveCurrent = inactiveFailure(last, true);
  if (inactiveCurrent !== null) return inactiveCurrent;
  const transactions = new Set<string>();
  let previous: PreparedChange | undefined;
  for (const current of changes) {
    if (transactions.has(current.change.transactionId))
      return { ok: false, reason: "invalid-change" };
    transactions.add(current.change.transactionId);
    const inactive = inactiveFailure(current, false);
    if (inactive !== null) return inactive;
    if (previous !== undefined) {
      const invalid = linkFailure(previous, current);
      if (invalid !== null) return invalid;
    }
    previous = current;
  }
  return null;
}

function comparePrepared(left: PreparedChange, right: PreparedChange): number {
  return left.firstOrdinal < right.firstOrdinal
    ? -1
    : left.firstOrdinal > right.firstOrdinal
      ? 1
      : 0;
}

function prepareChanges(
  input: readonly TransactionHistoryChange[],
  observationCutoff: string,
): PreparedResult {
  if (input.length === 0) return { ok: false, reason: "missing-history" };
  if (input.length > MAX_STAGE_EPISODE_CHANGES) return { ok: false, reason: "bounded-limit" };
  let cutoff: bigint;
  try {
    cutoff = Temporal.Instant.from(observationCutoff).epochNanoseconds;
  } catch {
    return { ok: false, reason: "invalid-observation-time" };
  }
  const first = input[0];
  if (first === undefined) return { ok: false, reason: "missing-history" };
  const changes: PreparedChange[] = [];
  let witnesses = 0;
  for (const change of input) {
    const identity = identityFailure(first, change);
    if (identity !== null) return identity;
    witnesses += change.eventIds.length;
    if (witnesses > MAX_STAGE_EPISODE_EVENT_WITNESSES)
      return { ok: false, reason: "bounded-limit" };
    const prepared = prepareChange(change, cutoff);
    if ("ok" in prepared) return prepared;
    changes.push(prepared);
  }
  changes.sort(comparePrepared);
  const invalid = sequenceFailure(changes);
  return invalid ?? { ok: true, changes, cutoff };
}

interface OpenDraft {
  entry: StageEpisodeEntry;
  observedStart: bigint;
  knownEntry: bigint | null;
}
interface Accumulator {
  completed: CompletedStageStay[];
  current: OpenDraft | null;
}

function witness(change: TransactionHistoryChange): StageEpisodeWitness {
  return {
    firstOrdinal: change.firstOrdinal,
    lastOrdinal: change.lastOrdinal,
    eventIds: [...change.eventIds],
  };
}

function openDraft(change: PreparedChange, state: StageState, reason: EntryReason): OpenDraft {
  const baseline = reason === "activation-baseline";
  return {
    entry: {
      pipelineId: state.pipelineId,
      stageId: state.stageId,
      enteredAt: baseline ? null : change.change.observedTo,
      observedFrom: change.change.observedTo,
      entryReason: reason,
      entryWitness: witness(change.change),
      leftCensored: baseline,
    },
    observedStart: change.observedTo,
    knownEntry: baseline ? null : change.observedTo,
  };
}

function finishStay(
  draft: OpenDraft,
  change: PreparedChange,
  reason: ExitReason,
): CompletedStageStay {
  return {
    ...draft.entry,
    endedAt: change.change.observedTo,
    exitReason: reason,
    exitWitness: witness(change.change),
    rightCensored: false,
    durationNanoseconds:
      draft.knownEntry === null ? null : (change.observedTo - draft.knownEntry).toString(),
    observedSpanNanoseconds: (change.observedTo - draft.observedStart).toString(),
  };
}

function advance(change: PreparedChange, result: Accumulator): Failure | null {
  const before = change.before,
    after = change.after;
  if (before === null || after === null) return { ok: false, reason: "incomplete-state-chain" };
  if (before.status !== "open") {
    if (after.status === "open") result.current = openDraft(change, after, "reopen");
    return null;
  }
  const draft = result.current;
  if (draft === null) return { ok: false, reason: "incomplete-state-chain" };
  const sameStage = before.pipelineId === after.pipelineId && before.stageId === after.stageId;
  if (after.status === "open" && sameStage) return null;
  const movement = before.pipelineId === after.pipelineId ? "stage-change" : "pipeline-change";
  const reason = after.status === "open" ? movement : after.status;
  result.completed.push(finishStay(draft, change, reason));
  result.current = after.status === "open" ? openDraft(change, after, movement) : null;
  return null;
}

function currentStage(
  draft: OpenDraft | null,
  observationCutoff: string,
  cutoff: bigint,
): CurrentOpenStage | null {
  if (draft === null) return null;
  return {
    ...draft.entry,
    observationCutoff,
    rightCensored: true,
    ageNanoseconds: draft.knownEntry === null ? null : (cutoff - draft.knownEntry).toString(),
    observedSpanNanoseconds: (cutoff - draft.observedStart).toString(),
  };
}

/**
 * One current deal incarnation, already bounded, snapshot-filtered and server-authorized.
 * Caller must establish a complete authorized snapshot chain through observationCutoff,
 * such as an available+complete repository result with the matching captured tip. A partial
 * repository result must be rejected before folding or deriving: these chain checks cannot
 * detect omitted later events, and an ordinal is not a completeness or visibility watermark.
 * Boundaries use the final row observation of each folded transaction, not commit or imported
 * business timestamps. This does not infer stage rank, prior visits, actor or source authority.
 * Deleted or archived evidence, including restored intervals, is unavailable until explicit
 * active/inactive aging semantics exist.
 */
export function deriveStageEpisodes(
  input: readonly TransactionHistoryChange[],
  observationCutoff: string,
): StageEpisodesResult {
  const prepared = prepareChanges(input, observationCutoff);
  if (!prepared.ok) return prepared;
  const first = prepared.changes[0],
    last = prepared.changes.at(-1);
  if (first === undefined || last === undefined) return { ok: false, reason: "invalid-change" };
  const initial = first.after,
    final = last.after;
  if (initial === null || final === null) return { ok: false, reason: "invalid-change" };
  const baseline = first.change.evidence === "activation-baseline";
  const result: Accumulator = { completed: [], current: null };
  if (initial.status === "open")
    result.current = openDraft(first, initial, baseline ? "activation-baseline" : "insert");
  for (const change of prepared.changes.slice(1)) {
    const failure = advance(change, result);
    if (failure !== null) return failure;
  }
  return {
    ok: true,
    entityId: first.change.entityId,
    incarnationId: first.change.incarnationId,
    activationId: first.change.activationId,
    observationBasis: HISTORY_OBSERVATION_BASIS,
    observationCutoff,
    quality: baseline ? "left-censored-at-activation" : "observed-from-insert",
    initialObservedStatus: initial.status,
    finalObservedStatus: final.status,
    completedStays: result.completed,
    currentOpenStage: currentStage(result.current, observationCutoff, prepared.cutoff),
  };
}
