import { describe, expect, test } from "vitest";
import { HISTORY_OBSERVATION_BASIS } from "./contracts";
import { projectStageAgingView, type StageAgingViewSource } from "./stageAgingView";
import {
  type CompletedDurationContributor,
  STAGE_STATISTIC_DEFINITION_VERSION,
  STAGE_STATISTIC_QUANTILES,
  type StageStatisticsGroup,
} from "./stageStatistics";

const captureStart = "2026-01-01T00:00:00.000000Z";
const observedAt = "2026-11-05T10:00:00.000000Z";
const stageKey = { pipelineId: "private-pipeline-key", stageId: "private-stage-key" };
const noQuantiles = {
  sampleCount: 0,
  distinctDealIncarnations: 0,
  medianNanoseconds: null,
  p75Nanoseconds: null,
  p90Nanoseconds: null,
  contributors: [],
};

function identity(suffix: string) {
  return {
    entityId: `private-deal-${suffix}`,
    incarnationId: `private-lifetime-${suffix}`,
    episodeIndex: 0,
  };
}

function lowerBound(suffix: string, lowerBoundNanoseconds: string) {
  return {
    ...identity(suffix),
    lowerBoundNanoseconds,
    observedFrom: captureStart,
    observedTo: observedAt,
  };
}

function collected(): Extract<StageAgingViewSource, { state: "collected" }> {
  const observation = { activationId: "private-capture-key", observationCutoff: observedAt };
  const group: StageStatisticsGroup = {
    ...stageKey,
    completed: {
      sampleCount: 2,
      distinctDealIncarnations: 2,
      medianNanoseconds: "9007199254740992.5",
      p75Nanoseconds: "9007199254740993",
      p90Nanoseconds: "9007199254740993",
      contributors: ["9007199254740992", "9007199254740993"].map(
        (durationNanoseconds, index): CompletedDurationContributor => ({
          ...identity(`completed-${index}`),
          enteredAt: captureStart,
          endedAt: observedAt,
          exitReason: "won",
          durationNanoseconds,
        }),
      ),
    },
    currentOpen: noQuantiles,
    leftCensored: {
      completed: {
        sampleCount: 2,
        distinctDealIncarnations: 2,
        contributors: [lowerBound("closed-1", "4000"), lowerBound("closed-2", "2000")],
      },
      currentOpen: {
        sampleCount: 1,
        distinctDealIncarnations: 1,
        contributors: [lowerBound("open", "80")],
      },
    },
  };
  return {
    state: "collected",
    observation,
    report: {
      state: "available",
      currency: "EUR",
      population: { basis: "current-authorized-live-deals", dealCount: 5, currentOpenDealCount: 1 },
      historyBasis: "observed-stays-of-current-cohort-since-capture",
      activatedAt: captureStart,
      statistics: {
        ok: true,
        ...observation,
        definitionVersion: STAGE_STATISTIC_DEFINITION_VERSION,
        observationBasis: HISTORY_OBSERVATION_BASIS,
        quantileMethod: STAGE_STATISTIC_QUANTILES,
        inputDealIncarnations: 5,
        episodeCount: 5,
        groups: [group],
      },
    },
    definitions: {
      observation,
      labels: [{ ...stageKey, pipelineName: "Current pipeline", stageName: "Current stage" }],
    },
  };
}

describe("stage aging viewer projection", () => {
  test("exposes only authorized names and separate exact aggregate populations", () => {
    expect(projectStageAgingView(collected())).toEqual({
      state: "available",
      currency: "EUR",
      dealCount: 5,
      currentOpenDealCount: 1,
      activatedAt: captureStart,
      observedAt,
      rows: [
        {
          pipelineName: "Current pipeline",
          stageName: "Current stage",
          completed: {
            sampleCount: 2,
            distinctDeals: 2,
            medianNanoseconds: "9007199254740992.5",
            p75Nanoseconds: "9007199254740993",
            p90Nanoseconds: "9007199254740993",
          },
          currentOpen: {
            sampleCount: 0,
            distinctDeals: 0,
            medianNanoseconds: null,
            p75Nanoseconds: null,
            p90Nanoseconds: null,
          },
          leftCensored: {
            completed: {
              sampleCount: 2,
              distinctDeals: 2,
              minimumNanoseconds: "2000",
              maximumNanoseconds: "4000",
            },
            currentOpen: {
              sampleCount: 1,
              distinctDeals: 1,
              minimumNanoseconds: "80",
              maximumNanoseconds: "80",
            },
          },
        },
      ],
    });
  });

  test("rejects a separate observation object even when the activation and cutoff match", () => {
    const source = collected();
    expect(
      projectStageAgingView({
        ...source,
        definitions: { ...source.definitions, observation: { ...source.observation } },
      }),
    ).toEqual({ state: "unavailable", reason: "read" });
  });

  test("withholds all rows and counts when the definition set does not match the report", () => {
    const source = collected();
    expect(
      projectStageAgingView({
        ...source,
        definitions: {
          observation: source.observation,
          labels: [
            {
              ...stageKey,
              stageId: "unrelated-stage",
              pipelineName: "Current pipeline",
              stageName: "Unrelated stage",
            },
          ],
        },
      }),
    ).toEqual({ state: "unavailable", reason: "read" });
  });

  test.each([
    "scope-limit",
    "history-limit",
    "history-invalid",
    "history-permission-limited",
    "stage-definition-unavailable",
    "history-read-failed",
  ] as const)("returns the same viewer failure for %s", (reason) => {
    expect(projectStageAgingView({ state: "unavailable", reason })).toEqual({
      state: "unavailable",
      reason: "read",
    });
  });

  test("distinguishes request denial from global capture unavailability", () => {
    expect(projectStageAgingView({ state: "unavailable", reason: "not-authorized" })).toEqual({
      state: "permission",
    });
    expect(projectStageAgingView({ state: "missing", reason: "capture-not-installed" })).toEqual({
      state: "unavailable",
      reason: "capture",
    });
  });
});
