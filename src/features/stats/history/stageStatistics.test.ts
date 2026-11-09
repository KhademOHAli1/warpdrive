import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, test } from "vitest";
import { HISTORY_OBSERVATION_BASIS } from "./contracts";
import type { CompletedStageStay, CurrentOpenStage, StageEpisodesResult } from "./stageEpisodes";
import {
  aggregateStageStatistics,
  MAX_STAGE_STATISTIC_DEALS,
  MAX_STAGE_STATISTIC_EPISODES,
  type StageStatisticsGroup,
  type StageStatisticsResult,
} from "./stageStatistics";

type Success = Extract<StageEpisodesResult, { ok: true }>;
const FRAME = { activationId: "activation-1", observationCutoff: "2030-01-01T00:00:00Z" };
const START = Temporal.Instant.from("2026-01-01T00:00:00Z").epochNanoseconds;
const CUTOFF = Temporal.Instant.from(FRAME.observationCutoff).epochNanoseconds;
const at = (value: bigint) => Temporal.Instant.fromEpochNanoseconds(value).toString();
const witness = { firstOrdinal: "1", lastOrdinal: "1", eventIds: ["recorded-entry"] };

function stay(
  duration: bigint,
  patch: Partial<CompletedStageStay> = {},
  offset = 0n,
): CompletedStageStay {
  return {
    pipelineId: "pipeline-a",
    stageId: "stage-a",
    enteredAt: at(START + offset),
    observedFrom: at(START + offset),
    entryReason: "insert",
    entryWitness: witness,
    leftCensored: false,
    endedAt: at(START + offset + duration),
    exitReason: "won",
    exitWitness: { firstOrdinal: "2", lastOrdinal: "2", eventIds: ["recorded-exit"] },
    rightCensored: false,
    durationNanoseconds: duration.toString(),
    observedSpanNanoseconds: duration.toString(),
    ...patch,
  };
}

function openStage(age: bigint, patch: Partial<CurrentOpenStage> = {}): CurrentOpenStage {
  return {
    pipelineId: "pipeline-a",
    stageId: "stage-a",
    enteredAt: at(CUTOFF - age),
    observedFrom: at(CUTOFF - age),
    entryReason: "insert",
    entryWitness: witness,
    leftCensored: false,
    observationCutoff: FRAME.observationCutoff,
    rightCensored: true,
    ageNanoseconds: age.toString(),
    observedSpanNanoseconds: age.toString(),
    ...patch,
  };
}

function record(
  entityId: string,
  completedStays: CompletedStageStay[] = [],
  currentOpenStage: CurrentOpenStage | null = null,
  patch: Partial<Success> = {},
): Success {
  return {
    ok: true,
    entityId,
    incarnationId: `incarnation-${entityId}`,
    activationId: FRAME.activationId,
    observationBasis: HISTORY_OBSERVATION_BASIS,
    observationCutoff: FRAME.observationCutoff,
    quality: "observed-from-insert",
    initialObservedStatus: completedStays.length > 0 || currentOpenStage !== null ? "open" : "won",
    finalObservedStatus: currentOpenStage === null ? "won" : "open",
    completedStays,
    currentOpenStage,
    ...patch,
  };
}

function singleGroup(result: StageStatisticsResult): StageStatisticsGroup {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`Expected statistics, got ${result.reason}`);
  expect(result.groups).toHaveLength(1);
  const group = result.groups[0];
  if (group === undefined) throw new Error("Expected a stage statistics group");
  return group;
}

describe("bounded descriptive stage statistics", () => {
  test("keeps empty authorized input reproducible without inventing a zero-duration sample", () => {
    expect(aggregateStageStatistics([], FRAME)).toMatchObject({
      ok: true,
      activationId: FRAME.activationId,
      observationCutoff: FRAME.observationCutoff,
      inputDealIncarnations: 0,
      episodeCount: 0,
      groups: [],
    });
  });

  test("uses an exact midpoint median and documented nearest-rank upper percentiles", () => {
    const group = singleGroup(
      aggregateStageStatistics(
        [
          record("d", [stay(4n)]),
          record("a", [stay(1n)]),
          record("c", [stay(3n)]),
          record("b", [stay(2n)]),
        ],
        FRAME,
      ),
    );
    expect(group.completed).toMatchObject({
      sampleCount: 4,
      distinctDealIncarnations: 4,
      medianNanoseconds: "2.5",
      p75Nanoseconds: "3",
      p90Nanoseconds: "4",
    });
    expect(group.completed.contributors.map((value) => value.entityId)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  test("retains exact half nanoseconds beyond the JavaScript safe-integer boundary", () => {
    const group = singleGroup(
      aggregateStageStatistics(
        [record("a", [stay(9_007_199_254_740_992n)]), record("b", [stay(9_007_199_254_740_993n)])],
        FRAME,
      ),
    );
    expect(group.completed).toMatchObject({
      medianNanoseconds: "9007199254740992.5",
      p75Nanoseconds: "9007199254740993",
      p90Nanoseconds: "9007199254740993",
    });
  });

  test("uses the ninth of ten observations for P90 rather than substituting the maximum", () => {
    const group = singleGroup(
      aggregateStageStatistics(
        Array.from({ length: 10 }, (_, index) =>
          record(`deal-${index}`, [stay(BigInt(index + 1))]),
        ),
        FRAME,
      ),
    );
    expect(group.completed).toMatchObject({
      medianNanoseconds: "5.5",
      p75Nanoseconds: "8",
      p90Nanoseconds: "9",
    });
  });

  test("keeps real zero and odd-sample medians", () => {
    const group = singleGroup(
      aggregateStageStatistics(
        [record("a", [stay(0n)]), record("b", [stay(10n)]), record("c", [stay(20n)])],
        FRAME,
      ),
    );
    expect(group.completed).toMatchObject({
      sampleCount: 3,
      medianNanoseconds: "10",
      p75Nanoseconds: "20",
      p90Nanoseconds: "20",
    });
    expect(group.completed.contributors[0]?.durationNanoseconds).toBe("0");
  });

  test("never mixes completed durations, open ages or left-censored lower bounds", () => {
    const completedBaseline = record(
      "baseline-exit",
      [
        stay(200n, {
          enteredAt: null,
          leftCensored: true,
          entryReason: "activation-baseline",
          durationNanoseconds: null,
        }),
      ],
      null,
      { quality: "left-censored-at-activation" },
    );
    const openBaseline = record(
      "baseline-open",
      [],
      openStage(300n, {
        enteredAt: null,
        leftCensored: true,
        entryReason: "activation-baseline",
        ageNanoseconds: null,
      }),
      { quality: "left-censored-at-activation" },
    );
    const group = singleGroup(
      aggregateStageStatistics(
        [
          record("complete-one", [stay(1n)]),
          record("complete-three", [stay(3n)]),
          record("open", [], openStage(100n)),
          completedBaseline,
          openBaseline,
        ],
        FRAME,
      ),
    );
    expect(group.completed).toMatchObject({
      sampleCount: 2,
      medianNanoseconds: "2",
      p90Nanoseconds: "3",
    });
    expect(group.currentOpen).toMatchObject({
      sampleCount: 1,
      medianNanoseconds: "100",
      p90Nanoseconds: "100",
    });
    expect(group.leftCensored.completed).toMatchObject({
      sampleCount: 1,
      contributors: [
        {
          entityId: "baseline-exit",
          incarnationId: "incarnation-baseline-exit",
          episodeIndex: 0,
          lowerBoundNanoseconds: "200",
        },
      ],
    });
    expect(group.leftCensored.currentOpen).toMatchObject({
      sampleCount: 1,
      contributors: [
        {
          entityId: "baseline-open",
          incarnationId: "incarnation-baseline-open",
          episodeIndex: 0,
          lowerBoundNanoseconds: "300",
        },
      ],
    });
  });

  test("returns null quantiles when a stage has only lower bounds", () => {
    const group = singleGroup(
      aggregateStageStatistics(
        [
          record(
            "baseline",
            [],
            openStage(50n, {
              enteredAt: null,
              leftCensored: true,
              entryReason: "activation-baseline",
              ageNanoseconds: null,
            }),
            { quality: "left-censored-at-activation" },
          ),
        ],
        FRAME,
      ),
    );
    expect(group.completed).toMatchObject({
      sampleCount: 0,
      medianNanoseconds: null,
      p75Nanoseconds: null,
      p90Nanoseconds: null,
      contributors: [],
    });
    expect(group.currentOpen).toMatchObject({
      sampleCount: 0,
      medianNanoseconds: null,
      p75Nanoseconds: null,
      p90Nanoseconds: null,
      contributors: [],
    });
    expect(group.leftCensored.currentOpen.sampleCount).toBe(1);
  });

  test.each(["completed", "current"] as const)(
    "rejects an initially open baseline misdeclared as an observed-entry %s sample",
    (kind) => {
      const source =
        kind === "completed"
          ? record("baseline", [stay(1n)], null, { quality: "left-censored-at-activation" })
          : record("baseline", [], openStage(1n), { quality: "left-censored-at-activation" });
      expect(aggregateStageStatistics([source], FRAME)).toEqual({
        ok: false,
        reason: "invalid-episode",
      });
    },
  );

  test("rejects an initially open baseline with no completed or current episode", () => {
    const source = record("baseline", [], null, {
      quality: "left-censored-at-activation",
      initialObservedStatus: "open",
      finalObservedStatus: "won",
    });
    expect(aggregateStageStatistics([source], FRAME)).toEqual({
      ok: false,
      reason: "invalid-episode",
    });
  });

  test("keeps an observed reopen after an initially closed baseline eligible for exact samples", () => {
    const group = singleGroup(
      aggregateStageStatistics(
        [
          record("closed-baseline", [stay(2n, { entryReason: "reopen" })], null, {
            quality: "left-censored-at-activation",
            initialObservedStatus: "won",
          }),
        ],
        FRAME,
      ),
    );
    expect(group.completed).toMatchObject({ sampleCount: 1, medianNanoseconds: "2" });
    expect(group.leftCensored.completed.sampleCount).toBe(0);
  });

  test("counts repeated visits as separate stays and preserves their deal/incarnation contribution", () => {
    const group = singleGroup(
      aggregateStageStatistics(
        [record("repeat", [stay(1n), stay(3n, { entryReason: "reopen" }, 2n)])],
        FRAME,
      ),
    );
    expect(group.completed).toMatchObject({
      sampleCount: 2,
      distinctDealIncarnations: 1,
      medianNanoseconds: "2",
    });
    expect(
      group.completed.contributors.map((value) => [
        value.entityId,
        value.incarnationId,
        value.episodeIndex,
      ]),
    ).toEqual([
      ["repeat", "incarnation-repeat", 0],
      ["repeat", "incarnation-repeat", 1],
    ]);
  });

  test("retains loss as a stage-exit reason without describing it as a successful close", () => {
    const group = singleGroup(
      aggregateStageStatistics(
        [record("lost", [stay(2n, { exitReason: "lost" })], null, { finalObservedStatus: "lost" })],
        FRAME,
      ),
    );
    expect(group.completed).toMatchObject({
      sampleCount: 1,
      medianNanoseconds: "2",
      contributors: [{ entityId: "lost", exitReason: "lost" }],
    });
    expect(group.currentOpen.sampleCount).toBe(0);
  });

  test("does not accept a completed movement exit whose destination episode is missing", () => {
    expect(
      aggregateStageStatistics(
        [record("incomplete", [stay(1n, { exitReason: "stage-change" })])],
        FRAME,
      ),
    ).toEqual({ ok: false, reason: "invalid-episode" });
  });

  test.each(["stage-change", "pipeline-change"] as const)(
    "accepts the immediate recorded destination of a %s",
    (movement) => {
      const nextPipeline = movement === "stage-change" ? "pipeline-a" : "pipeline-b";
      const source = record("moved", [
        stay(1n, { exitReason: movement }),
        stay(2n, { entryReason: movement, stageId: "stage-b", pipelineId: nextPipeline }, 1n),
      ]);
      const result = aggregateStageStatistics([source], FRAME);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Expected complete movement episodes");
      expect(result.episodeCount).toBe(2);
      expect(result.groups).toHaveLength(2);
    },
  );

  test("rejects a delayed movement destination, wrong entry reason or unchanged movement identity", () => {
    const moved = stay(1n, { exitReason: "stage-change" });
    const delayed = stay(1n, { entryReason: "stage-change", stageId: "stage-b" }, 2n);
    const wrongReason = stay(1n, { entryReason: "reopen", stageId: "stage-b" }, 1n);
    const unchangedStage = stay(1n, { entryReason: "stage-change" }, 1n);
    for (const destination of [delayed, wrongReason, unchangedStage]) {
      expect(aggregateStageStatistics([record("broken", [moved, destination])], FRAME)).toEqual({
        ok: false,
        reason: "invalid-episode",
      });
    }
    expect(
      aggregateStageStatistics(
        [
          record("wrong-pipeline", [
            stay(1n, { exitReason: "pipeline-change" }),
            stay(1n, { entryReason: "pipeline-change", stageId: "stage-b" }, 1n),
          ]),
        ],
        FRAME,
      ),
    ).toEqual({ ok: false, reason: "invalid-episode" });
  });

  test("permits closed-state outcome corrections and stage or pipeline corrections before reopening", () => {
    const corrected = singleGroup(
      aggregateStageStatistics(
        [record("corrected-outcome", [stay(1n)], null, { finalObservedStatus: "lost" })],
        FRAME,
      ),
    );
    expect(corrected.completed.contributors[0]?.exitReason).toBe("won");
    const reopened = aggregateStageStatistics(
      [
        record("reopened-after-correction", [
          stay(1n),
          stay(2n, { entryReason: "reopen", pipelineId: "pipeline-b", stageId: "stage-b" }, 3n),
        ]),
      ],
      FRAME,
    );
    expect(reopened.ok).toBe(true);
    if (!reopened.ok)
      throw new Error("Expected valid reopened history after closed-state corrections");
    expect(reopened.groups).toHaveLength(2);
  });

  test("groups only exact pipeline/stage identity and remains deterministic under input order", () => {
    const input = [
      record("c", [stay(2n, { pipelineId: "pipeline-b", stageId: "stage-a" })]),
      record("b", [stay(1n, { pipelineId: "pipeline-a", stageId: "stage-b" })]),
      record("a", [stay(3n)]),
    ];
    const before = JSON.stringify(input);
    const result = aggregateStageStatistics(input, FRAME);
    expect(result).toEqual(aggregateStageStatistics([...input].reverse(), FRAME));
    expect(JSON.stringify(input)).toBe(before);
    if (!result.ok) throw new Error("Expected identity-grouped statistics");
    expect(result.groups.map((group) => [group.pipelineId, group.stageId])).toEqual([
      ["pipeline-a", "stage-a"],
      ["pipeline-a", "stage-b"],
      ["pipeline-b", "stage-a"],
    ]);
  });

  test("rejects identical duplicate deal/incarnation results instead of inflating samples", () => {
    const source = record("same", [stay(1n)]);
    expect(aggregateStageStatistics([source, source], FRAME)).toEqual({
      ok: false,
      reason: "duplicate-incarnation",
    });
    expect(
      aggregateStageStatistics([source, { ...source, completedStays: [stay(2n)] }], FRAME),
    ).toEqual({ ok: false, reason: "duplicate-incarnation" });
  });

  test("retains distinct authorized incarnations as distinct contributors without collapsing UUID reuse", () => {
    const group = singleGroup(
      aggregateStageStatistics(
        [
          record("same-id", [stay(1n)]),
          record("same-id", [stay(3n)], null, { incarnationId: "second-incarnation" }),
        ],
        FRAME,
      ),
    );
    expect(group.completed).toMatchObject({ sampleCount: 2, distinctDealIncarnations: 2 });
  });

  test("rejects mixed activations and different cutoff instants", () => {
    expect(
      aggregateStageStatistics([record("a", [], null, { activationId: "activation-2" })], FRAME),
    ).toEqual({ ok: false, reason: "mixed-activation" });
    expect(
      aggregateStageStatistics(
        [record("a", [], null, { observationCutoff: "2030-01-01T00:00:00.000000001Z" })],
        FRAME,
      ),
    ).toEqual({ ok: false, reason: "mixed-cutoff" });
  });

  test("accepts an equivalent offset representation of the same observation cutoff", () => {
    const input = record("a", [stay(1n)], null, { observationCutoff: "2030-01-01T01:00:00+01:00" });
    expect(aggregateStageStatistics([input], FRAME).ok).toBe(true);
  });

  test.each([
    "-1",
    "-0",
    "01",
    "+1",
    "1.0",
    "1e3",
    "NaN",
    "",
    " 1",
    "1 ",
    "9".repeat(24),
    "17280000000000000000001",
  ])("rejects malformed duration text %j", (quantity) => {
    expect(
      aggregateStageStatistics([record("a", [stay(1n, { durationNanoseconds: quantity })])], FRAME),
    ).toEqual({ ok: false, reason: "invalid-quantity" });
  });

  test("rejects numeric quantities, inconsistent declared spans and invented completed durations", () => {
    const numeric = { ...stay(1n), durationNanoseconds: 1 } as unknown as CompletedStageStay;
    expect(aggregateStageStatistics([record("numeric", [numeric])], FRAME)).toEqual({
      ok: false,
      reason: "invalid-quantity",
    });
    expect(
      aggregateStageStatistics(
        [record("span", [stay(1n, { observedSpanNanoseconds: "2" })])],
        FRAME,
      ),
    ).toEqual({ ok: false, reason: "invalid-quantity" });
    expect(
      aggregateStageStatistics(
        [record("duration", [stay(1n, { durationNanoseconds: "2" })])],
        FRAME,
      ),
    ).toEqual({ ok: false, reason: "invalid-quantity" });
  });

  test("rejects duration or age assertions on left-censored entries", () => {
    const left = {
      enteredAt: null,
      leftCensored: true,
      entryReason: "activation-baseline",
    } as const;
    expect(
      aggregateStageStatistics(
        [record("completed", [stay(1n, left)], null, { quality: "left-censored-at-activation" })],
        FRAME,
      ),
    ).toEqual({ ok: false, reason: "invalid-quantity" });
    expect(
      aggregateStageStatistics(
        [record("open", [], openStage(1n, left), { quality: "left-censored-at-activation" })],
        FRAME,
      ),
    ).toEqual({ ok: false, reason: "invalid-quantity" });
  });

  test("rejects missing observed-entry quantities and invalid baseline declarations", () => {
    expect(
      aggregateStageStatistics([record("a", [stay(1n, { durationNanoseconds: null })])], FRAME),
    ).toEqual({ ok: false, reason: "invalid-quantity" });
    expect(
      aggregateStageStatistics([record("b", [], openStage(1n, { ageNanoseconds: null }))], FRAME),
    ).toEqual({ ok: false, reason: "invalid-quantity" });
    expect(
      aggregateStageStatistics(
        [record("c", [stay(1n, { entryReason: "activation-baseline" })])],
        FRAME,
      ),
    ).toEqual({ ok: false, reason: "invalid-episode" });
  });

  test("rejects open-age arithmetic mismatches and a different current-stage cutoff", () => {
    expect(
      aggregateStageStatistics([record("a", [], openStage(1n, { ageNanoseconds: "2" }))], FRAME),
    ).toEqual({ ok: false, reason: "invalid-quantity" });
    expect(
      aggregateStageStatistics(
        [record("b", [], openStage(1n, { observationCutoff: "2030-01-02T00:00:00Z" }))],
        FRAME,
      ),
    ).toEqual({ ok: false, reason: "mixed-cutoff" });
  });

  test("rejects time reversal, future evidence and overlapping visits", () => {
    expect(
      aggregateStageStatistics([record("a", [stay(1n, { endedAt: at(START - 1n) })])], FRAME),
    ).toEqual({ ok: false, reason: "invalid-observation-time" });
    expect(
      aggregateStageStatistics(
        [record("b", [stay(1n, { endedAt: "2031-01-01T00:00:00Z" })])],
        FRAME,
      ),
    ).toEqual({ ok: false, reason: "invalid-observation-time" });
    expect(aggregateStageStatistics([record("c", [stay(3n), stay(2n, {}, 1n)])], FRAME)).toEqual({
      ok: false,
      reason: "invalid-episode",
    });
  });

  test("rejects inconsistent final status and current-stage declarations", () => {
    expect(
      aggregateStageStatistics([record("a", [], null, { finalObservedStatus: "open" })], FRAME),
    ).toEqual({ ok: false, reason: "invalid-episode" });
    expect(
      aggregateStageStatistics(
        [record("b", [], openStage(1n), { finalObservedStatus: "lost" })],
        FRAME,
      ),
    ).toEqual({ ok: false, reason: "invalid-episode" });
  });

  test("rejects failed episode results and malformed frames rather than silently dropping them", () => {
    expect(aggregateStageStatistics([{ ok: false, reason: "missing-history" }], FRAME)).toEqual({
      ok: false,
      reason: "unavailable-episodes",
    });
    expect(aggregateStageStatistics([], { ...FRAME, activationId: "" })).toEqual({
      ok: false,
      reason: "invalid-frame",
    });
    expect(aggregateStageStatistics([], { ...FRAME, observationCutoff: "not-an-instant" })).toEqual(
      { ok: false, reason: "invalid-frame" },
    );
  });

  test("bounds the number of deals before processing duplicate or nested observations", () => {
    const source = record("same");
    const input = Array.from({ length: MAX_STAGE_STATISTIC_DEALS + 1 }, () => source);
    expect(aggregateStageStatistics(input, FRAME)).toEqual({ ok: false, reason: "bounded-limit" });
  });

  test("bounds nested episodes both within one deal and across the whole input", () => {
    const sample = stay(1n);
    const tooMany = Array.from({ length: MAX_STAGE_STATISTIC_EPISODES + 1 }, () => sample);
    expect(aggregateStageStatistics([record("one", tooMany)], FRAME)).toEqual({
      ok: false,
      reason: "bounded-limit",
    });
    const half = Math.floor(MAX_STAGE_STATISTIC_EPISODES / 2);
    expect(
      aggregateStageStatistics(
        [record("a", tooMany.slice(0, half)), record("b", tooMany.slice(0, half + 1))],
        FRAME,
      ),
    ).toEqual({ ok: false, reason: "bounded-limit" });
  });
});
