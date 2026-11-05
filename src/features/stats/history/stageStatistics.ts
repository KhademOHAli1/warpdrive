import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
import { HISTORY_OBSERVATION_BASIS } from "./contracts";
import type { CompletedStageStay, StageEpisodesResult } from "./stageEpisodes";

export const MAX_STAGE_STATISTIC_DEALS = 5_000;
export const MAX_STAGE_STATISTIC_EPISODES = 50_000;
export const STAGE_STATISTIC_DEFINITION_VERSION = 1;

export const STAGE_STATISTIC_QUANTILES = {
  median: "Arithmetic midpoint of the central observations; exact half nanoseconds are retained.",
  p75: "Nearest rank: the observation at ceil(3 × sample count / 4), counting from one.",
  p90: "Nearest rank: the observation at ceil(9 × sample count / 10), counting from one.",
  population: "Stage stays; repeated observed visits contribute separate observations.",
  censoring: "Left-censored baseline spans are lower bounds and enter no duration or age quantile.",
} as const;

export interface StageStatisticsFrame {
  activationId: string;
  observationCutoff: string;
}

interface ContributorIdentity {
  entityId: string;
  incarnationId: string;
  episodeIndex: number;
}

export interface CompletedDurationContributor extends ContributorIdentity {
  durationNanoseconds: string;
  enteredAt: string;
  endedAt: string;
  exitReason: CompletedStageStay["exitReason"];
}

export interface CurrentAgeContributor extends ContributorIdentity {
  ageNanoseconds: string;
  enteredAt: string;
  observationCutoff: string;
}

export interface StageLowerBoundContributor extends ContributorIdentity {
  lowerBoundNanoseconds: string;
  observedFrom: string;
  observedTo: string;
}

export interface StageSamples<Contributor> {
  sampleCount: number;
  distinctDealIncarnations: number;
  medianNanoseconds: string | null;
  p75Nanoseconds: string | null;
  p90Nanoseconds: string | null;
  contributors: Contributor[];
}

export interface StageLowerBounds {
  sampleCount: number;
  distinctDealIncarnations: number;
  contributors: StageLowerBoundContributor[];
}

export interface StageStatisticsGroup {
  pipelineId: string;
  stageId: string;
  completed: StageSamples<CompletedDurationContributor>;
  currentOpen: StageSamples<CurrentAgeContributor>;
  leftCensored: { completed: StageLowerBounds; currentOpen: StageLowerBounds };
}

export type StageStatisticsFailureReason =
  | "invalid-frame"
  | "bounded-limit"
  | "unavailable-episodes"
  | "duplicate-incarnation"
  | "mixed-activation"
  | "mixed-cutoff"
  | "invalid-episode"
  | "invalid-observation-time"
  | "invalid-quantity";

export type StageStatisticsResult =
  | { ok: false; reason: StageStatisticsFailureReason }
  | {
      ok: true;
      definitionVersion: typeof STAGE_STATISTIC_DEFINITION_VERSION;
      observationBasis: typeof HISTORY_OBSERVATION_BASIS;
      activationId: string;
      observationCutoff: string;
      inputDealIncarnations: number;
      episodeCount: number;
      quantileMethod: typeof STAGE_STATISTIC_QUANTILES;
      groups: StageStatisticsGroup[];
    };

type Failure = Extract<StageStatisticsResult, { ok: false }>;
type SuccessfulEpisodes = Extract<StageEpisodesResult, { ok: true }>;
const failure = (reason: StageStatisticsFailureReason): Failure => ({ ok: false, reason });
const idText = z
  .string()
  .refine((value) => value.length > 0 && value.length <= 160 && /\S/.test(value));
const timeText = z.string().min(1).max(100);
const status = z.enum(["open", "won", "lost"]);
const metadata = z.object({
  entityId: idText,
  incarnationId: idText,
  activationId: idText,
  observationBasis: z.literal(HISTORY_OBSERVATION_BASIS),
  observationCutoff: timeText,
  quality: z.enum(["observed-from-insert", "left-censored-at-activation"]),
  initialObservedStatus: status,
  finalObservedStatus: status,
});
const entry = z.object({
  pipelineId: idText,
  stageId: idText,
  enteredAt: timeText.nullable(),
  observedFrom: timeText,
  entryReason: z.enum([
    "activation-baseline",
    "insert",
    "stage-change",
    "pipeline-change",
    "reopen",
  ]),
  leftCensored: z.boolean(),
  observedSpanNanoseconds: z.unknown(),
});
const completed = entry.extend({
  endedAt: timeText,
  exitReason: z.enum(["stage-change", "pipeline-change", "won", "lost"]),
  rightCensored: z.literal(false),
  durationNanoseconds: z.unknown(),
});
const currentOpen = entry.extend({
  observationCutoff: timeText,
  rightCensored: z.literal(true),
  ageNanoseconds: z.unknown(),
});

function instant(value: string): bigint | null {
  try {
    return Temporal.Instant.from(value).epochNanoseconds;
  } catch {
    return null;
  }
}

// The largest possible difference between two supported Temporal instants has 23
// decimal digits. Check length before constructing BigInt from caller-supplied text.
const MAX_SPAN_NANOSECONDS = 17_280_000_000_000_000_000_000n;
function nanoseconds(value: unknown): bigint | null {
  if (typeof value !== "string" || value.length > 23 || !/^(0|[1-9]\d*)$/.test(value)) return null;
  const parsed = BigInt(value);
  return parsed <= MAX_SPAN_NANOSECONDS ? parsed : null;
}

interface PreparedEntry {
  ok: true;
  quantity: bigint | null;
  lowerBound: bigint;
  observedFrom: bigint;
  observedTo: bigint;
}

function prepareKnownEntry(
  value: z.infer<typeof entry>,
  from: bigint,
  end: bigint,
  lowerBound: bigint,
  declared: unknown,
): PreparedEntry | Failure {
  if (value.enteredAt === null || value.entryReason === "activation-baseline")
    return failure("invalid-episode");
  const entered = instant(value.enteredAt);
  if (entered === null || entered > end) return failure("invalid-observation-time");
  if (entered !== from) return failure("invalid-episode");
  const quantity = nanoseconds(declared);
  if (quantity === null || quantity !== end - entered) return failure("invalid-quantity");
  return { ok: true, quantity, lowerBound, observedFrom: from, observedTo: end };
}

function prepareEntry(
  value: z.infer<typeof entry>,
  end: bigint,
  declared: unknown,
): PreparedEntry | Failure {
  const from = instant(value.observedFrom);
  if (from === null || from > end) return failure("invalid-observation-time");
  const lowerBound = nanoseconds(value.observedSpanNanoseconds);
  if (lowerBound === null || lowerBound !== end - from) return failure("invalid-quantity");
  if (value.leftCensored) {
    if (value.enteredAt !== null || value.entryReason !== "activation-baseline")
      return failure("invalid-episode");
    if (declared !== null) return failure("invalid-quantity");
    return { ok: true, quantity: null, lowerBound, observedFrom: from, observedTo: end };
  }
  return prepareKnownEntry(value, from, end, lowerBound, declared);
}

interface GroupDraft {
  pipelineId: string;
  stageId: string;
  completed: CompletedDurationContributor[];
  open: CurrentAgeContributor[];
  completedLowerBounds: StageLowerBoundContributor[];
  openLowerBounds: StageLowerBoundContributor[];
}

function groupFor(
  groups: Map<string, GroupDraft>,
  pipelineId: string,
  stageId: string,
): GroupDraft {
  const key = JSON.stringify([pipelineId, stageId]);
  const found = groups.get(key);
  if (found !== undefined) return found;
  const created: GroupDraft = {
    pipelineId,
    stageId,
    completed: [],
    open: [],
    completedLowerBounds: [],
    openLowerBounds: [],
  };
  groups.set(key, created);
  return created;
}

function lowerBound(
  identity: ContributorIdentity,
  value: z.infer<typeof entry>,
  prepared: PreparedEntry,
  observedTo: string,
): StageLowerBoundContributor {
  return {
    ...identity,
    lowerBoundNanoseconds: prepared.lowerBound.toString(),
    observedFrom: value.observedFrom,
    observedTo,
  };
}

interface PreviousStay {
  value: z.infer<typeof completed>;
  end: bigint;
}

function firstEntryFailure(
  record: SuccessfulEpisodes,
  value: z.infer<typeof entry>,
): Failure | null {
  if (record.initialObservedStatus !== "open") {
    return value.entryReason === "reopen" && !value.leftCensored
      ? null
      : failure("invalid-episode");
  }
  const baseline = record.quality === "left-censored-at-activation";
  const expectedReason = baseline ? "activation-baseline" : "insert";
  return value.entryReason === expectedReason && value.leftCensored === baseline
    ? null
    : failure("invalid-episode");
}

function nextEntryFailure(
  previous: PreviousStay,
  value: z.infer<typeof entry>,
  from: bigint,
): Failure | null {
  const reason = previous.value.exitReason;
  if (reason === "won" || reason === "lost") {
    return value.entryReason === "reopen" && from >= previous.end
      ? null
      : failure("invalid-episode");
  }
  if (from !== previous.end || value.entryReason !== reason) return failure("invalid-episode");
  if (reason === "stage-change") {
    return value.pipelineId === previous.value.pipelineId &&
      value.stageId !== previous.value.stageId
      ? null
      : failure("invalid-episode");
  }
  return value.pipelineId !== previous.value.pipelineId ? null : failure("invalid-episode");
}

function entryContinuity(
  record: SuccessfulEpisodes,
  previous: PreviousStay | null,
  value: z.infer<typeof entry>,
  prepared: PreparedEntry,
): Failure | null {
  return previous === null
    ? firstEntryFailure(record, value)
    : nextEntryFailure(previous, value, prepared.observedFrom);
}

function prepareCompleted(
  record: SuccessfulEpisodes,
  raw: CompletedStageStay,
  cutoff: bigint,
  previous: PreviousStay | null,
): Failure | { ok: true; value: z.infer<typeof completed>; prepared: PreparedEntry } {
  const parsed = completed.safeParse(raw);
  if (!parsed.success) return failure("invalid-episode");
  const value = parsed.data,
    end = instant(value.endedAt);
  if (end === null || end > cutoff) return failure("invalid-observation-time");
  const prepared = prepareEntry(value, end, value.durationNanoseconds);
  if (!prepared.ok) return prepared;
  const invalid = entryContinuity(record, previous, value, prepared);
  if (invalid !== null) return invalid;
  return { ok: true, value, prepared };
}

function addCompleted(
  record: SuccessfulEpisodes,
  groups: Map<string, GroupDraft>,
  cutoff: bigint,
): Failure | { ok: true; lastStay: PreviousStay | null } {
  let previous: PreviousStay | null = null;
  for (const [index, raw] of record.completedStays.entries()) {
    const ready = prepareCompleted(record, raw, cutoff, previous);
    if (!ready.ok) return ready;
    const { value, prepared } = ready;
    previous = { value, end: prepared.observedTo };
    const identity = {
      entityId: record.entityId,
      incarnationId: record.incarnationId,
      episodeIndex: index,
    };
    const group = groupFor(groups, value.pipelineId, value.stageId);
    if (prepared.quantity === null) {
      group.completedLowerBounds.push(lowerBound(identity, value, prepared, value.endedAt));
    } else {
      // A known quantity can only result from an observed, non-null entry above.
      if (value.enteredAt === null) return failure("invalid-episode");
      group.completed.push({
        ...identity,
        durationNanoseconds: prepared.quantity.toString(),
        enteredAt: value.enteredAt,
        endedAt: value.endedAt,
        exitReason: value.exitReason,
      });
    }
  }
  return { ok: true, lastStay: previous };
}

function closedSequenceFailure(
  record: SuccessfulEpisodes,
  previous: PreviousStay | null,
): Failure | null {
  if (previous === null)
    return record.initialObservedStatus === "open" ? failure("invalid-episode") : null;
  // A won/lost correction while already closed creates no additional open stay.
  // A movement exit, however, requires its destination episode before final closure.
  return previous.value.exitReason === "won" || previous.value.exitReason === "lost"
    ? null
    : failure("invalid-episode");
}

function addCurrent(
  record: SuccessfulEpisodes,
  groups: Map<string, GroupDraft>,
  cutoff: bigint,
  previous: PreviousStay | null,
): Failure | null {
  if ((record.finalObservedStatus === "open") !== (record.currentOpenStage !== null))
    return failure("invalid-episode");
  if (record.currentOpenStage === null) return closedSequenceFailure(record, previous);
  const parsed = currentOpen.safeParse(record.currentOpenStage);
  if (!parsed.success) return failure("invalid-episode");
  const value = parsed.data,
    declaredCutoff = instant(value.observationCutoff);
  if (declaredCutoff === null) return failure("invalid-observation-time");
  if (declaredCutoff !== cutoff) return failure("mixed-cutoff");
  const prepared = prepareEntry(value, cutoff, value.ageNanoseconds);
  if (!prepared.ok) return prepared;
  const invalid = entryContinuity(record, previous, value, prepared);
  if (invalid !== null) return invalid;
  const identity = {
    entityId: record.entityId,
    incarnationId: record.incarnationId,
    episodeIndex: record.completedStays.length,
  };
  const group = groupFor(groups, value.pipelineId, value.stageId);
  if (prepared.quantity === null)
    group.openLowerBounds.push(lowerBound(identity, value, prepared, value.observationCutoff));
  else {
    if (value.enteredAt === null) return failure("invalid-episode");
    group.open.push({
      ...identity,
      ageNanoseconds: prepared.quantity.toString(),
      enteredAt: value.enteredAt,
      observationCutoff: value.observationCutoff,
    });
  }
  return null;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
function compareContributors(left: ContributorIdentity, right: ContributorIdentity): number {
  return (
    compareText(left.entityId, right.entityId) ||
    compareText(left.incarnationId, right.incarnationId) ||
    left.episodeIndex - right.episodeIndex
  );
}
function distinctIncarnations(values: readonly ContributorIdentity[]): number {
  return new Set(values.map((value) => JSON.stringify([value.entityId, value.incarnationId]))).size;
}
function median(sorted: readonly bigint[]): string | null {
  const lower = sorted[Math.floor((sorted.length - 1) / 2)],
    upper = sorted[Math.floor(sorted.length / 2)];
  if (lower === undefined || upper === undefined) return null;
  const sum = lower + upper;
  return sum % 2n === 0n ? (sum / 2n).toString() : `${sum / 2n}.5`;
}
function nearestRank(
  sorted: readonly bigint[],
  numerator: number,
  denominator: number,
): string | null {
  const index = Math.floor((sorted.length * numerator + denominator - 1) / denominator) - 1;
  return sorted[index]?.toString() ?? null;
}
function summarize<Contributor extends ContributorIdentity>(
  values: Contributor[],
  quantities: bigint[],
): StageSamples<Contributor> {
  const sorted = [...quantities].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return {
    sampleCount: values.length,
    distinctDealIncarnations: distinctIncarnations(values),
    medianNanoseconds: median(sorted),
    p75Nanoseconds: nearestRank(sorted, 3, 4),
    p90Nanoseconds: nearestRank(sorted, 9, 10),
    contributors: [...values].sort(compareContributors),
  };
}
function summarizeLowerBounds(values: StageLowerBoundContributor[]): StageLowerBounds {
  return {
    sampleCount: values.length,
    distinctDealIncarnations: distinctIncarnations(values),
    contributors: [...values].sort(compareContributors),
  };
}
function finalize(group: GroupDraft): StageStatisticsGroup {
  return {
    pipelineId: group.pipelineId,
    stageId: group.stageId,
    completed: summarize(
      group.completed,
      group.completed.map((value) => BigInt(value.durationNanoseconds)),
    ),
    currentOpen: summarize(
      group.open,
      group.open.map((value) => BigInt(value.ageNanoseconds)),
    ),
    leftCensored: {
      completed: summarizeLowerBounds(group.completedLowerBounds),
      currentOpen: summarizeLowerBounds(group.openLowerBounds),
    },
  };
}

function boundedPopulation(
  input: readonly StageEpisodesResult[],
): Failure | { ok: true; records: SuccessfulEpisodes[]; count: number } {
  if (input.length > MAX_STAGE_STATISTIC_DEALS) return failure("bounded-limit");
  let count = 0;
  const records: SuccessfulEpisodes[] = [];
  for (const record of input) {
    if (!record.ok) return failure("unavailable-episodes");
    if (!Array.isArray(record.completedStays)) return failure("invalid-episode");
    count += record.completedStays.length + (record.currentOpenStage === null ? 0 : 1);
    if (count > MAX_STAGE_STATISTIC_EPISODES) return failure("bounded-limit");
    records.push(record);
  }
  return { ok: true, records, count };
}

function addRecord(
  record: SuccessfulEpisodes,
  activationId: string,
  cutoff: bigint,
  identities: Set<string>,
  groups: Map<string, GroupDraft>,
): Failure | null {
  if (!metadata.safeParse(record).success) return failure("invalid-episode");
  if (record.activationId !== activationId) return failure("mixed-activation");
  const observedCutoff = instant(record.observationCutoff);
  if (observedCutoff === null) return failure("invalid-observation-time");
  if (observedCutoff !== cutoff) return failure("mixed-cutoff");
  const identity = JSON.stringify([record.entityId, record.incarnationId]);
  if (identities.has(identity)) return failure("duplicate-incarnation");
  identities.add(identity);
  const completedResult = addCompleted(record, groups, cutoff);
  if (!completedResult.ok) return completedResult;
  return addCurrent(record, groups, cutoff, completedResult.lastStay);
}

/**
 * Descriptive aggregation of already authorized, successful episode results. This
 * performs no source lookup, stage-order inference, permission check or model qualification.
 * Matching activation/cutoff metadata does not prove a common database snapshot or
 * eligible cohort; the collecting report adapter must establish both before aggregation.
 * Every repeated stay is a sample; duplicate deal/incarnation inputs are rejected, even
 * when identical. Equivalent offset spellings of one cutoff instant are accepted.
 */
export function aggregateStageStatistics(
  input: readonly StageEpisodesResult[],
  frame: StageStatisticsFrame,
): StageStatisticsResult {
  if (
    !idText.safeParse(frame.activationId).success ||
    !timeText.safeParse(frame.observationCutoff).success
  )
    return failure("invalid-frame");
  const cutoff = instant(frame.observationCutoff);
  if (cutoff === null) return failure("invalid-frame");
  const bounded = boundedPopulation(input);
  if (!bounded.ok) return bounded;
  const identities = new Set<string>(),
    groups = new Map<string, GroupDraft>();
  for (const record of bounded.records) {
    const invalid = addRecord(record, frame.activationId, cutoff, identities, groups);
    if (invalid !== null) return invalid;
  }
  return {
    ok: true,
    definitionVersion: STAGE_STATISTIC_DEFINITION_VERSION,
    observationBasis: HISTORY_OBSERVATION_BASIS,
    activationId: frame.activationId,
    observationCutoff: frame.observationCutoff,
    inputDealIncarnations: bounded.records.length,
    episodeCount: bounded.count,
    quantileMethod: STAGE_STATISTIC_QUANTILES,
    groups: [...groups.values()]
      .sort(
        (left, right) =>
          compareText(left.pipelineId, right.pipelineId) ||
          compareText(left.stageId, right.stageId),
      )
      .map(finalize),
  };
}
