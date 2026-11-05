import { describe, expect, test } from "vitest";
import type { HistoryActivation } from "./contracts";
import { assessHistoryCoverage } from "./coverage";

const ACTIVATION: HistoryActivation = {
  activationId: "00000000-0000-4000-8000-000000000001",
  schemaVersion: 2,
  activatedAt: "2026-11-05T12:00:00.000001Z",
  captureSemantics: "database-row-observation-v1",
};
const CUTOFF = "2026-11-05T13:00:00Z";

describe("observed history coverage", () => {
  test("returns missing capture rather than a historical zero when no activation exists", () => {
    expect(assessHistoryCoverage(null, "2026-11-01T00:00:00Z", CUTOFF)).toEqual({
      state: "missing",
      reason: "capture-not-installed",
      reliableFrom: null,
      observationCutoff: CUTOFF,
      pastTransitionsInferred: false,
    });
  });

  test("marks a period starting before activation as partial without backfilling transitions", () => {
    expect(assessHistoryCoverage(ACTIVATION, "2026-01-01T00:00:00Z", CUTOFF)).toEqual({
      state: "partial",
      reason: "before-activation",
      reliableFrom: ACTIVATION.activatedAt,
      observationCutoff: CUTOFF,
      pastTransitionsInferred: false,
    });
  });

  test("does not use a future activation as evidence available at an earlier cutoff", () => {
    const cutoff = "2026-11-05T12:00:00.000000999Z";
    expect(assessHistoryCoverage(ACTIVATION, "2026-11-05T11:00:00Z", cutoff)).toMatchObject({
      state: "missing",
      reason: "capture-not-installed",
      observationCutoff: cutoff,
      pastTransitionsInferred: false,
    });
  });

  test.each([ACTIVATION.activatedAt, "2026-11-05T12:00:00.000001001Z", "2026-11-05T12:59:59Z"])(
    "accepts a period starting at or after the exact activation instant: %s",
    (from) => {
      expect(assessHistoryCoverage(ACTIVATION, from, CUTOFF)).toEqual({
        state: "observed",
        reason: "within-observed-interval",
        reliableFrom: ACTIVATION.activatedAt,
        observationCutoff: CUTOFF,
        pastTransitionsInferred: false,
      });
    },
  );

  test("includes the exact activation instant even when it is also the observation cutoff", () => {
    expect(
      assessHistoryCoverage(ACTIVATION, ACTIVATION.activatedAt, ACTIVATION.activatedAt),
    ).toMatchObject({
      state: "observed",
      reason: "within-observed-interval",
      pastTransitionsInferred: false,
    });
  });

  test("does not round away the nanosecond immediately before a microsecond activation", () => {
    expect(
      assessHistoryCoverage(ACTIVATION, "2026-11-05T12:00:00.000000999Z", CUTOFF),
    ).toMatchObject({
      state: "partial",
      reason: "before-activation",
      pastTransitionsInferred: false,
    });
  });

  test("compares equivalent offset instants rather than their lexical labels", () => {
    expect(
      assessHistoryCoverage(
        ACTIVATION,
        "2026-11-05T14:00:00.000001+02:00",
        "2026-11-05T15:00:00+02:00",
      ),
    ).toMatchObject({
      state: "observed",
      reason: "within-observed-interval",
    });
  });

  test("returns invalid for a reversed observation window", () => {
    expect(assessHistoryCoverage(ACTIVATION, "2026-11-05T14:00:00Z", CUTOFF)).toMatchObject({
      state: "invalid",
      reason: "invalid-window",
      pastTransitionsInferred: false,
    });
  });

  test.each([
    ["not-an-instant", CUTOFF],
    ["2026-11-05T12:00:00Z", "not-a-cutoff"],
    ["2026-11-05", CUTOFF],
    ["2026-11-05T12:00:00", CUTOFF],
  ])("rejects malformed or non-instant bounds without throwing: %s, %s", (from, cutoff) => {
    expect(() => assessHistoryCoverage(ACTIVATION, from, cutoff)).not.toThrow();
    expect(assessHistoryCoverage(ACTIVATION, from, cutoff)).toMatchObject({
      state: "invalid",
      reason: "invalid-window",
      pastTransitionsInferred: false,
    });
  });

  test("rejects a malformed activation timestamp instead of inventing its start", () => {
    expect(
      assessHistoryCoverage(
        { ...ACTIVATION, activatedAt: "invalid" },
        "2026-11-05T12:00:00Z",
        CUTOFF,
      ),
    ).toMatchObject({
      state: "invalid",
      reason: "invalid-window",
      pastTransitionsInferred: false,
    });
  });
});
