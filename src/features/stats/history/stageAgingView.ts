import type { CurrentStageAging } from "./currentStageAgingRepository";

type AvailableAging = Extract<CurrentStageAging, { state: "available" }>;
type AgingGroup = AvailableAging["statistics"]["groups"][number];
type UnavailableAging = Exclude<CurrentStageAging, AvailableAging>;

// The server collector must mint one object inside its read transaction and use that
// same object for the captured statistics and authorized current definition labels.
// Identity guards against mixing collector results. It does not establish authority.
export interface StageAgingObservation {
  readonly activationId: string;
  readonly observationCutoff: string;
}

export interface AuthorizedCurrentStageLabel {
  readonly pipelineId: string;
  readonly stageId: string;
  readonly pipelineName: string;
  readonly stageName: string;
}

export type StageAgingViewSource =
  | UnavailableAging
  | {
      state: "collected";
      report: AvailableAging;
      observation: StageAgingObservation;
      definitions: {
        observation: StageAgingObservation;
        labels: readonly AuthorizedCurrentStageLabel[];
      };
    };

interface SampleCounts {
  sampleCount: number;
  distinctDeals: number;
}

export interface StageAgingQuantiles extends SampleCounts {
  medianNanoseconds: string | null;
  p75Nanoseconds: string | null;
  p90Nanoseconds: string | null;
}

export interface StageAgingLowerBounds extends SampleCounts {
  minimumNanoseconds: string | null;
  maximumNanoseconds: string | null;
}

export interface StageAgingRow {
  pipelineName: string;
  stageName: string;
  completed: StageAgingQuantiles;
  currentOpen: StageAgingQuantiles;
  leftCensored: {
    completed: StageAgingLowerBounds;
    currentOpen: StageAgingLowerBounds;
  };
}

export type StageAgingUnavailableReason = "capture" | "read";

export type StageAgingView =
  | { state: "loading" }
  | { state: "permission" }
  | { state: "unavailable"; reason: StageAgingUnavailableReason }
  | {
      state: "available";
      currency: string;
      dealCount: number;
      currentOpenDealCount: number;
      activatedAt: string;
      observedAt: string;
      rows: StageAgingRow[];
    };

const spanText = /^(0|[1-9][0-9]{0,22})(?:\.5)?$/;
const integerSpanText = /^(0|[1-9][0-9]{0,22})$/;

function groupKey({
  pipelineId,
  stageId,
}: Pick<AuthorizedCurrentStageLabel, "pipelineId" | "stageId">): string {
  return JSON.stringify([pipelineId, stageId]);
}

function unavailable(reason: StageAgingUnavailableReason): StageAgingView {
  return { state: "unavailable", reason };
}

function projectUnavailable({ reason }: UnavailableAging): StageAgingView {
  switch (reason) {
    case "not-authorized":
      return { state: "permission" };
    case "capture-not-installed":
    case "capture-metadata-invalid":
    case "capture-safety-unavailable":
      return unavailable("capture");
    case "scope-limit":
    case "history-limit":
    case "history-permission-limited":
    case "stage-definition-unavailable":
    case "history-invalid":
    case "aging-evidence-unavailable":
    case "invalid-request":
    case "history-read-failed":
    case "source-writes-pending":
      // History caps and definition/authority failures can depend on pre-authorization
      // events. Keep them indistinguishable in the viewer.
      return unavailable("read");
  }
}

function projectQuantiles(
  sample: AgingGroup["completed"] | AgingGroup["currentOpen"],
): StageAgingQuantiles | null {
  const { medianNanoseconds, p75Nanoseconds, p90Nanoseconds } = sample;
  const values = [medianNanoseconds, p75Nanoseconds, p90Nanoseconds];
  const valid =
    sample.sampleCount === 0
      ? values.every((value) => value === null)
      : values.every((value) => value !== null && spanText.test(value));
  if (!valid) return null;

  return {
    sampleCount: sample.sampleCount,
    distinctDeals: sample.distinctDealIncarnations,
    medianNanoseconds,
    p75Nanoseconds,
    p90Nanoseconds,
  };
}

function projectLowerBounds(
  sample: AgingGroup["leftCensored"]["completed"],
): StageAgingLowerBounds | null {
  if (sample.sampleCount !== sample.contributors.length) return null;
  let minimum: bigint | null = null;
  let maximum: bigint | null = null;
  for (const { lowerBoundNanoseconds } of sample.contributors) {
    if (!integerSpanText.test(lowerBoundNanoseconds)) return null;
    const span = BigInt(lowerBoundNanoseconds);
    if (minimum === null || span < minimum) minimum = span;
    if (maximum === null || span > maximum) maximum = span;
  }

  return {
    sampleCount: sample.sampleCount,
    distinctDeals: sample.distinctDealIncarnations,
    minimumNanoseconds: minimum?.toString() ?? null,
    maximumNanoseconds: maximum?.toString() ?? null,
  };
}

function projectRow(group: AgingGroup, label: AuthorizedCurrentStageLabel): StageAgingRow | null {
  const completed = projectQuantiles(group.completed);
  const currentOpen = projectQuantiles(group.currentOpen);
  const completedLowerBounds = projectLowerBounds(group.leftCensored.completed);
  const openLowerBounds = projectLowerBounds(group.leftCensored.currentOpen);
  if (
    completed === null ||
    currentOpen === null ||
    completedLowerBounds === null ||
    openLowerBounds === null
  ) {
    return null;
  }

  return {
    pipelineName: label.pipelineName,
    stageName: label.stageName,
    completed,
    currentOpen,
    leftCensored: { completed: completedLowerBounds, currentOpen: openLowerBounds },
  };
}

function labelIndex(
  source: Extract<StageAgingViewSource, { state: "collected" }>,
): Map<string, AuthorizedCurrentStageLabel> | null {
  const { report, observation, definitions } = source;
  if (
    observation !== definitions.observation ||
    observation.activationId !== report.statistics.activationId ||
    observation.observationCutoff !== report.statistics.observationCutoff ||
    definitions.labels.length !== report.statistics.groups.length
  ) {
    return null;
  }

  const labels = new Map<string, AuthorizedCurrentStageLabel>();
  for (const label of definitions.labels) {
    const key = groupKey(label);
    if (labels.has(key) || label.pipelineName.trim() === "" || label.stageName.trim() === "") {
      return null;
    }
    labels.set(key, label);
  }
  return labels;
}

/** Server-side allowlist from an already authorized collection. Send only the returned view to clients. */
export function projectStageAgingView(source: StageAgingViewSource): StageAgingView {
  if (source.state !== "collected") return projectUnavailable(source);
  const labels = labelIndex(source);
  if (labels === null) return unavailable("read");

  const { report } = source;
  const rows: StageAgingRow[] = [];
  for (const group of report.statistics.groups) {
    const key = groupKey(group);
    const label = labels.get(key);
    if (label === undefined) return unavailable("read");
    const row = projectRow(group, label);
    if (row === null) return unavailable("read");
    labels.delete(key);
    rows.push(row);
  }

  return {
    state: "available",
    currency: report.currency,
    dealCount: report.population.dealCount,
    currentOpenDealCount: report.population.currentOpenDealCount,
    activatedAt: report.activatedAt,
    observedAt: report.statistics.observationCutoff,
    rows,
  };
}
