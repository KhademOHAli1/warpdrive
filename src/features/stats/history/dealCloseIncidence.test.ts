import { describe, expect, test } from "vitest";
import {
  computeDealCloseIncidence,
  type DealCloseIncidenceInput,
  type DealCloseSubject,
  MAX_DEAL_CLOSE_SUBJECTS,
} from "./dealCloseIncidence";

const captureActivatedAt = "2026-03-01T00:00:00Z";
const cutoff = "2026-03-11T00:00:00Z";
const day = 86_400_000_000_000n;
const stillOpen = { kind: "still-open", observedThrough: cutoff } as const;

function close(id: string, cause: "won" | "lost", at: string): DealCloseSubject["outcome"] {
  return { kind: "first-qualified-close", cause, eventId: `close:${id}`, at };
}

function subject(
  id: string,
  enteredAt: string,
  outcome: DealCloseSubject["outcome"] = stillOpen,
): DealCloseSubject {
  return {
    subjectId: id,
    entryBasis: "observed-deal-insert",
    entryEventId: `insert:${id}`,
    enteredAt,
    outcome,
  };
}

function request(subjects: readonly DealCloseSubject[]): DealCloseIncidenceInput {
  return {
    source: {
      definitionId: "capture-fixture-v1",
      completeness: "complete",
      captureActivatedAt,
      expectedSubjectCount: subjects.length,
    },
    observationCutoff: cutoff,
    subjects,
  };
}

const open = subject("open", "2026-03-10T00:00:00Z");

describe("descriptive deal close incidence", () => {
  test("withdraws earlier censors and keeps tied censors in the closing risk set", () => {
    const subjects = [
      subject("win-3", "2026-03-01T00:00:00Z", close("win-3", "won", "2026-03-04T00:00:00Z")),
      subject("late-censor", "2026-03-07T00:00:00Z"),
      subject("tied-censor", "2026-03-09T00:00:00Z"),
      open,
      subject("loss-2", "2026-03-03T00:00:00Z", close("loss-2", "lost", "2026-03-05T00:00:00Z")),
      subject("tied-win", "2026-03-04T00:00:00Z", close("tied-win", "won", "2026-03-06T00:00:00Z")),
    ];
    const result = computeDealCloseIncidence(request(subjects));
    expect(result).toEqual({
      state: "available",
      definition: "observed-deal-first-close-aj-v1",
      sourceDefinitionId: "capture-fixture-v1",
      captureActivatedAt,
      observationCutoff: cutoff,
      censoring: "administrative-at-shared-cutoff",
      evidence: "observed-wins",
      subjectCount: 6,
      observed: { won: 2, lost: 1, rightCensored: 3 },
      steps: [
        {
          elapsedNanoseconds: day.toString(),
          atRiskBefore: 6,
          won: 0,
          lost: 0,
          rightCensored: 1,
          atRiskAfter: 5,
          probability: { won: "0.000000000", lost: "0.000000000", eventFree: "1.000000000" },
        },
        {
          elapsedNanoseconds: (2n * day).toString(),
          atRiskBefore: 5,
          won: 1,
          lost: 1,
          rightCensored: 1,
          atRiskAfter: 2,
          probability: { won: "0.200000000", lost: "0.200000000", eventFree: "0.600000000" },
        },
        {
          elapsedNanoseconds: (3n * day).toString(),
          atRiskBefore: 2,
          won: 1,
          lost: 0,
          rightCensored: 0,
          atRiskAfter: 1,
          probability: { won: "0.500000000", lost: "0.200000000", eventFree: "0.300000000" },
        },
        {
          elapsedNanoseconds: (4n * day).toString(),
          atRiskBefore: 1,
          won: 0,
          lost: 0,
          rightCensored: 1,
          atRiskAfter: 0,
          probability: { won: "0.500000000", lost: "0.200000000", eventFree: "0.300000000" },
        },
      ],
    });
    expect(computeDealCloseIncidence(request([...subjects].reverse()))).toEqual(result);
  });

  test("conserves rounded mass when exact thirds exhaust the risk set", () => {
    const tied = "2026-03-02T00:00:00Z";
    const result = computeDealCloseIncidence(
      request([
        subject("a", captureActivatedAt, close("a", "lost", tied)),
        subject("b", captureActivatedAt, close("b", "won", tied)),
        subject("c", captureActivatedAt, close("c", "lost", tied)),
      ]),
    );
    expect(result).toMatchObject({
      state: "available",
      steps: [
        {
          atRiskBefore: 3,
          atRiskAfter: 0,
          probability: { won: "0.333333333", lost: "0.666666667", eventFree: "0.000000000" },
        },
      ],
    });
  });

  test("conserves event-free zero with complementary half-unit ties", () => {
    const subjects = Array.from({ length: 1_024 }, (_, index) => {
      const id = `half:${index}`;
      return subject(id, cutoff, close(id, index === 0 ? "won" : "lost", cutoff));
    });
    expect(computeDealCloseIncidence(request(subjects))).toMatchObject({
      state: "available",
      steps: [
        {
          probability: { won: "0.000976563", lost: "0.999023437", eventFree: "0.000000000" },
        },
      ],
    });
  });

  test("distinguishes no entrants, all censors, and observed losses without wins", () => {
    expect(computeDealCloseIncidence(request([]))).toMatchObject({
      state: "available",
      evidence: "empty",
      subjectCount: 0,
      steps: [],
    });
    expect(computeDealCloseIncidence(request([open]))).toMatchObject({
      state: "available",
      evidence: "all-censored",
      observed: { won: 0, lost: 0, rightCensored: 1 },
      steps: [
        {
          atRiskBefore: 1,
          atRiskAfter: 0,
          probability: { won: "0.000000000", lost: "0.000000000", eventFree: "1.000000000" },
        },
      ],
    });
    expect(
      computeDealCloseIncidence(
        request([subject("lost", "2026-03-10T00:00:00Z", close("lost", "lost", cutoff)), open]),
      ),
    ).toMatchObject({
      state: "available",
      evidence: "no-wins",
      observed: { won: 0, lost: 1, rightCensored: 1 },
      steps: [
        {
          atRiskBefore: 2,
          atRiskAfter: 0,
          probability: { won: "0.000000000", lost: "0.500000000", eventFree: "0.500000000" },
        },
      ],
    });
  });

  test("preserves zero age, nanosecond ordering, and equivalent cutoff offsets", () => {
    const exactCutoff = "2026-03-11T00:00:00.000000001Z";
    const sameCutoff = "2026-03-10T19:00:00.000000001-05:00";
    const result = computeDealCloseIncidence({
      ...request([
        subject("win", cutoff, close("win", "won", cutoff)),
        subject("censored", cutoff, { kind: "still-open", observedThrough: sameCutoff }),
        subject("lost", cutoff, close("lost", "lost", exactCutoff)),
      ]),
      observationCutoff: exactCutoff,
    });
    expect(result).toMatchObject({
      state: "available",
      observationCutoff: exactCutoff,
      steps: [
        { elapsedNanoseconds: "0", atRiskBefore: 3, atRiskAfter: 2, won: 1 },
        {
          elapsedNanoseconds: "1",
          atRiskBefore: 2,
          atRiskAfter: 0,
          lost: 1,
          rightCensored: 1,
          probability: { won: "0.333333333", lost: "0.333333333", eventFree: "0.333333334" },
        },
      ],
    });
  });

  test.each(["incomplete", "truncated"] as const)("refuses a %s population", (completeness) => {
    const input = request([open]);
    expect(
      computeDealCloseIncidence({ ...input, source: { ...input.source, completeness } }),
    ).toEqual({ state: "unavailable", reason: "incomplete-source" });
  });

  test("refuses missing cutoff, count mismatch, and over-budget membership", () => {
    const input = request([open]);
    expect(computeDealCloseIncidence({ ...input, observationCutoff: undefined })).toEqual({
      state: "unavailable",
      reason: "invalid-request",
    });
    expect(computeDealCloseIncidence({ ...input, subjects: [] })).toEqual({
      state: "unavailable",
      reason: "membership-count-mismatch",
    });
    const oversized = MAX_DEAL_CLOSE_SUBJECTS + 1;
    expect(
      computeDealCloseIncidence({ ...input, subjects: new Array<unknown>(oversized) }),
    ).toEqual({ state: "unavailable", reason: "bounded-limit" });
    expect(
      computeDealCloseIncidence({
        ...input,
        source: { ...input.source, expectedSubjectCount: oversized },
      }),
    ).toEqual({ state: "unavailable", reason: "bounded-limit" });
  });

  test("refuses legacy origins, unknown outcomes, and duplicate membership or evidence", () => {
    expect(
      computeDealCloseIncidence(request([{ ...open, entryBasis: "legacy-baseline" }])),
    ).toEqual({ state: "unavailable", reason: "unqualified-origin" });
    expect(computeDealCloseIncidence(request([{ ...open, outcome: { kind: "unknown" } }]))).toEqual(
      { state: "unavailable", reason: "unknown-outcome" },
    );
    expect(computeDealCloseIncidence(request([open, open]))).toEqual({
      state: "unavailable",
      reason: "duplicate-subject",
    });
    expect(computeDealCloseIncidence(request([open, { ...open, subjectId: "another" }]))).toEqual({
      state: "unavailable",
      reason: "duplicate-evidence",
    });
    expect(
      computeDealCloseIncidence(
        request([
          {
            ...open,
            outcome: {
              kind: "first-qualified-close",
              cause: "won",
              eventId: open.entryEventId,
              at: cutoff,
            },
          },
        ]),
      ),
    ).toEqual({ state: "unavailable", reason: "duplicate-evidence" });
  });

  test("refuses incomplete follow-up and chronology outside qualified coverage", () => {
    const inconsistent = { state: "unavailable", reason: "inconsistent-coverage" };
    expect(
      computeDealCloseIncidence(request([subject("pre-capture", "2026-02-28T00:00:00Z")])),
    ).toEqual(inconsistent);
    expect(
      computeDealCloseIncidence(
        request([
          { ...open, outcome: { kind: "still-open", observedThrough: "2026-03-10T12:00:00Z" } },
        ]),
      ),
    ).toEqual(inconsistent);
    expect(
      computeDealCloseIncidence(
        request([{ ...open, outcome: close("future", "lost", "2026-03-11T00:00:00.000000001Z") }]),
      ),
    ).toEqual(inconsistent);
    expect(
      computeDealCloseIncidence(
        request([{ ...open, outcome: close("before-entry", "won", "2026-03-09T00:00:00Z") }]),
      ),
    ).toEqual(inconsistent);
    expect(
      computeDealCloseIncidence({ ...request([]), observationCutoff: "2026-02-28T00:00:00Z" }),
    ).toEqual(inconsistent);
  });
});
