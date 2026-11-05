import { describe, expect, test } from "vitest";
import {
  computeFixedExperimentReadout,
  type FixedExperimentDesign,
  type FixedExperimentInput,
  fixedExperimentDesignFingerprint,
  MAX_FIXED_EXPERIMENT_UNITS,
} from "./fixedExperimentReadout";

const design = {
  experimentId: "exp-v1",
  version: 1,
  hypothesisRef: "hypothesis-v1",
  eligibilityPolicyRef: "eligible-v1",
  randomizationProtocolRef: "randomization-v1",
  assignmentScheme: "independent-bernoulli",
  treatmentProbability: 0.8,
  designKind: "ab",
  unitKind: "person",
  controlVariantId: "control-v1",
  treatmentVariantId: "treatment-v1",
  frozenAt: "2026-04-01T00:00:00Z",
  eligibilityFrom: "2026-04-02T00:00:00Z",
  assignmentFrom: "2026-04-03T00:00:00Z",
  outcomeFrom: "2026-04-05T00:00:00Z",
  outcomeToExclusive: "2026-04-07T00:00:00Z",
  cutoff: "2026-04-08T00:00:00Z",
  primary: { metricId: "purchase", policyRef: "purchase-v1", minimumLift: 0.1 },
  guardrail: { metricId: "complaint", policyRef: "complaint-v1", maximumIncrease: 0.05 },
} satisfies FixedExperimentDesign;

interface FixtureUnit {
  arm: "control" | "treatment";
  exposed?: boolean;
  primary?: boolean;
  guardrail?: boolean;
}

type Evidence = FixedExperimentInput["evidence"][number];
type Outcome = Evidence["primary"];

function metric(
  unitId: string,
  metricId: string,
  observed: boolean,
  frozen: FixedExperimentDesign,
): Outcome {
  if (!observed) return { kind: "absent", unitId, metricId, observedThrough: frozen.cutoff };
  return {
    kind: "present",
    unitId,
    metricId,
    eventId: `endpoint:${metricId}:${unitId}`,
    effectiveAt: frozen.outcomeFrom,
    capturedAt: frozen.cutoff,
  };
}

function fixture(
  specs: readonly FixtureUnit[],
  frozen: FixedExperimentDesign = design,
): FixedExperimentInput {
  const designFingerprint = fixedExperimentDesignFingerprint(frozen);
  if (designFingerprint === null) throw new Error("Fixture requires a valid design");
  const roster = specs.map((_spec, index) => ({
    unitId: `unit:${index}`,
    eventId: `eligibility:${index}`,
    effectiveAt: frozen.eligibilityFrom,
    capturedAt: frozen.eligibilityFrom,
  }));
  const evidence = specs.map((spec, index): Evidence => {
    const unitId = `unit:${index}`;
    const assignmentEventId = `assignment:${index}`;
    const binding = { experimentId: frozen.experimentId, unitKind: frozen.unitKind, unitId };
    const variantId = spec.arm === "control" ? frozen.controlVariantId : frozen.treatmentVariantId;
    return {
      unitId,
      assignment: {
        ...binding,
        eventId: assignmentEventId,
        method: "randomized",
        variantId,
        effectiveAt: frozen.assignmentFrom,
        capturedAt: frozen.assignmentFrom,
      },
      exposure:
        spec.exposed === true
          ? {
              kind: "matched",
              ...binding,
              variantId,
              assignmentEventId,
              eventId: `exposure:${index}`,
              effectiveAt: "2026-04-04T00:00:00Z",
              capturedAt: frozen.cutoff,
              observedThrough: frozen.cutoff,
            }
          : { kind: "unexposed", observedThrough: frozen.cutoff },
      primary: metric(unitId, frozen.primary.metricId, spec.primary === true, frozen),
      guardrail: metric(unitId, frozen.guardrail.metricId, spec.guardrail === true, frozen),
    };
  });
  return {
    design: frozen,
    source: {
      designFingerprint,
      cutoff: frozen.cutoff,
      expectedUnits: specs.length,
      qualification: "qualified-complete",
      analysisHistory: "first-and-only-planned",
      contamination: "clear",
    },
    roster,
    evidence,
  };
}

const two = () =>
  fixture([
    { arm: "control", primary: true },
    { arm: "treatment", exposed: true },
  ]);

function changeFirst(
  input: FixedExperimentInput,
  change: (evidence: Evidence) => Evidence,
): FixedExperimentInput {
  return {
    ...input,
    evidence: input.evidence.map((evidence, index) => (index === 0 ? change(evidence) : evidence)),
  };
}

describe("fixed two-arm binary ITT", () => {
  test("uses every assigned unit, including unexposed conversions and an A/B baseline exposure", () => {
    const input = fixture([
      { arm: "control", exposed: true, primary: true },
      { arm: "control", guardrail: true },
      { arm: "treatment", exposed: true },
      { arm: "treatment", primary: true, guardrail: true },
      { arm: "treatment", primary: true },
    ]);
    const result = computeFixedExperimentReadout(input);
    expect(result).toMatchObject({
      state: "available",
      population: "all-qualified-assigned-units",
      contrast: "treatment-minus-control",
      control: { assigned: 2, exposed: 1, primary: 1, guardrail: 1 },
      treatment: { assigned: 3, exposed: 1, primary: 2, guardrail: 1 },
      primary: { controlRisk: 1 / 2, treatmentRisk: 2 / 3, decision: "inconclusive" },
      guardrail: { controlRisk: 1 / 2, treatmentRisk: 1 / 3, decision: "inconclusive" },
      uncertainty: { familyAlpha: 0.05, endpointAlpha: 0.025, look: "one-fixed-cutoff" },
    });
    if (result.state !== "available") throw new Error("Expected an ITT readout");
    expect(result.primary.difference).toBeCloseTo(1 / 6, 14);
    expect(result.guardrail.difference).toBeCloseTo(-1 / 6, 14);
    expect(result.primary.interval).toEqual({ lower: -1, upper: 1 });
    expect(
      computeFixedExperimentReadout({
        ...input,
        roster: [...input.roster].reverse(),
        evidence: [...input.evidence].reverse(),
      }),
    ).toEqual(result);
  });

  test("matches hand-calculated unequal-allocation holdout bounds and criteria", () => {
    const result = computeFixedExperimentReadout(
      fixture(
        [
          ...Array.from(
            { length: 20 },
            (_, index): FixtureUnit => ({
              arm: "control",
              primary: index < 5,
              guardrail: index < 10,
            }),
          ),
          ...Array.from(
            { length: 80 },
            (_, index): FixtureUnit => ({
              arm: "treatment",
              exposed: index < 40,
              primary: index < 60,
            }),
          ),
        ],
        { ...design, designKind: "holdout" },
      ),
    );
    expect(result).toMatchObject({
      state: "available",
      designKind: "holdout",
      control: { assigned: 20, exposed: 0, primary: 5, guardrail: 10 },
      treatment: { assigned: 80, exposed: 40, primary: 60, guardrail: 0 },
      primary: { difference: 0.5, minimumLift: 0.1, decision: "criterion-demonstrated" },
      guardrail: { difference: -0.5, maximumIncrease: 0.05, decision: "criterion-demonstrated" },
    });
    if (result.state !== "available") throw new Error("Expected a holdout readout");
    // (1/20 + 1/80) / 2 = 1/32. Two tails at .025 yield ln(80).
    const width = Math.sqrt(Math.log(80) / 32);
    expect(result.primary.interval.lower).toBeCloseTo(0.5 - width, 14);
    expect(result.primary.interval.upper).toBeCloseTo(0.5 + width, 14);
    expect(result.guardrail.interval.lower).toBeCloseTo(-0.5 - width, 14);
    expect(result.guardrail.interval.upper).toBeCloseTo(-0.5 + width, 14);
  });

  test("binds the exact frozen design, unit allocation, and analysis cutoff", () => {
    const input = two();
    expect(
      fixedExperimentDesignFingerprint({ ...design, cutoff: "2026-04-07T20:00:00-04:00" }),
    ).toBe(input.source.designFingerprint);
    expect(
      fixedExperimentDesignFingerprint({ ...design, outcomeFrom: design.assignmentFrom }),
    ).toBeNull();
    expect(
      fixedExperimentDesignFingerprint({ ...design, treatmentVariantId: design.controlVariantId }),
    ).toBeNull();
    expect(
      computeFixedExperimentReadout({
        ...input,
        design: { ...design, treatmentProbability: 0.5 },
      }),
    ).toEqual({ state: "unavailable", reason: "design-or-cutoff-mismatch" });
    expect(
      computeFixedExperimentReadout({
        ...input,
        design: { ...design, primary: { ...design.primary, minimumLift: 0 } },
      }),
    ).toEqual({ state: "unavailable", reason: "design-or-cutoff-mismatch" });
    expect(
      computeFixedExperimentReadout({
        ...input,
        source: { ...input.source, cutoff: "2026-04-07T23:59:59.999999999Z" },
      }),
    ).toEqual({ state: "unavailable", reason: "design-or-cutoff-mismatch" });
  });

  test("refuses missing, duplicate, foreign, and unassigned roster membership", () => {
    const input = two();
    expect(
      computeFixedExperimentReadout({ ...input, evidence: input.evidence.slice(0, 1) }),
    ).toEqual({ state: "unavailable", reason: "incomplete-roster" });
    expect(computeFixedExperimentReadout({ ...input, roster: input.roster.slice(0, 1) })).toEqual({
      state: "unavailable",
      reason: "incomplete-roster",
    });
    expect(
      computeFixedExperimentReadout({ ...input, roster: [input.roster[0], input.roster[0]] }),
    ).toEqual({ state: "unavailable", reason: "duplicate-unit" });
    expect(
      computeFixedExperimentReadout({ ...input, evidence: [input.evidence[0], input.evidence[0]] }),
    ).toEqual({ state: "unavailable", reason: "duplicate-unit" });
    expect(
      computeFixedExperimentReadout(changeFirst(input, (row) => ({ ...row, unitId: "foreign" }))),
    ).toEqual({ state: "unavailable", reason: "incomplete-roster" });
    expect(
      computeFixedExperimentReadout(changeFirst(input, (row) => ({ ...row, assignment: null }))),
    ).toEqual({ state: "unavailable", reason: "unqualified-assignment" });
  });

  test("refuses foreign or observational assignments and repeated witness keys", () => {
    const input = two();
    for (const patch of [
      { method: "observational" },
      { unitId: "unit:1" },
      { experimentId: "foreign" },
    ] as const) {
      const altered = changeFirst(input, (row) => {
        if (row.assignment === null) throw new Error("Expected fixture assignment");
        return { ...row, assignment: { ...row.assignment, ...patch } };
      });
      expect(computeFixedExperimentReadout(altered)).toEqual({
        state: "unavailable",
        reason: "unqualified-assignment",
      });
    }
    const duplicate = changeFirst(input, (row) => {
      if (row.assignment === null) throw new Error("Expected fixture assignment");
      return { ...row, assignment: { ...row.assignment, eventId: "eligibility:1" } };
    });
    expect(computeFixedExperimentReadout(duplicate)).toEqual({
      state: "unavailable",
      reason: "duplicate-evidence",
    });
  });

  test("refuses unknown or out-of-window endpoints and follow-up before the cutoff", () => {
    const input = two();
    const lastInstant = "2026-04-06T23:59:59.999999999Z";
    const at = (effectiveAt: string, capturedAt: string = design.cutoff) =>
      changeFirst(input, (row) => {
        if (row.primary.kind !== "present") throw new Error("Expected fixture conversion");
        return { ...row, primary: { ...row.primary, effectiveAt, capturedAt } };
      });
    expect(computeFixedExperimentReadout(at(lastInstant))).toMatchObject({ state: "available" });
    for (const invalid of [
      at(design.outcomeToExclusive),
      at(design.outcomeFrom, "2026-04-08T00:00:00.000000001Z"),
      changeFirst(input, (row) => ({ ...row, guardrail: { kind: "unknown" } })),
      changeFirst(input, (row) => ({
        ...row,
        guardrail: {
          kind: "absent",
          unitId: row.unitId,
          metricId: "complaint",
          observedThrough: design.outcomeToExclusive,
        },
      })),
    ]) {
      expect(computeFixedExperimentReadout(invalid)).toEqual({
        state: "unavailable",
        reason: "unqualified-outcome",
      });
    }
  });

  test("refuses missing exposure surveillance, crossover, and exposed holdout control", () => {
    const input = fixture([{ arm: "control", exposed: true }, { arm: "treatment" }]);
    const crossover = changeFirst(input, (row) => {
      if (row.exposure.kind !== "matched") throw new Error("Expected fixture exposure");
      return { ...row, exposure: { ...row.exposure, variantId: design.treatmentVariantId } };
    });
    expect(computeFixedExperimentReadout(crossover)).toEqual({
      state: "unavailable",
      reason: "contamination",
    });
    expect(
      computeFixedExperimentReadout(
        fixture([{ arm: "control", exposed: true }, { arm: "treatment" }], {
          ...design,
          designKind: "holdout",
        }),
      ),
    ).toEqual({ state: "unavailable", reason: "contamination" });
    expect(
      computeFixedExperimentReadout(
        changeFirst(input, (row) => ({
          ...row,
          exposure: { kind: "unknown" },
        })),
      ),
    ).toEqual({ state: "unavailable", reason: "unqualified-exposure" });
  });

  test("refuses no observations, missing arms, truncation, unverified overlap, and repeated looks", () => {
    const input = two();
    expect(computeFixedExperimentReadout(fixture([]))).toEqual({
      state: "unavailable",
      reason: "no-observations",
    });
    expect(computeFixedExperimentReadout(fixture([{ arm: "control" }]))).toEqual({
      state: "unavailable",
      reason: "missing-arm",
    });
    for (const [patch, reason] of [
      [{ qualification: "truncated" }, "source-unqualified"],
      [{ qualification: "incomplete" }, "source-unqualified"],
      [{ analysisHistory: "repeated" }, "unqualified-analysis-look"],
      [{ analysisHistory: "unknown" }, "unqualified-analysis-look"],
      [{ contamination: "unknown" }, "contamination"],
      [{ expectedUnits: MAX_FIXED_EXPERIMENT_UNITS + 1 }, "bounded-limit"],
    ] as const) {
      expect(
        computeFixedExperimentReadout({ ...input, source: { ...input.source, ...patch } }),
      ).toEqual({ state: "unavailable", reason });
    }
  });
});
