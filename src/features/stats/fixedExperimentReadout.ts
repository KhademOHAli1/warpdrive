import { createHash } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";

export const MAX_FIXED_EXPERIMENT_UNITS = 10_000;
const definition = "fixed-binary-itt-v1";
const familyAlpha = 0.05;
const endpointAlpha = familyAlpha / 2;
const id = z.string().min(1).max(160).regex(/\S/);
const unitKind = z.enum(["person", "account"]);
const instant = z
  .string()
  .max(80)
  .datetime({ offset: true })
  .transform((value, context) => {
    try {
      return Temporal.Instant.from(value).epochNanoseconds;
    } catch {
      context.addIssue({ code: "custom", message: "Invalid exact instant" });
      return z.NEVER;
    }
  });

const threshold = z.number().min(0).max(1);
const designSchema = z.strictObject({
  experimentId: id,
  version: z.number().int().positive(),
  hypothesisRef: id,
  eligibilityPolicyRef: id,
  randomizationProtocolRef: id,
  assignmentScheme: z.literal("independent-bernoulli"),
  treatmentProbability: z.number().gt(0).lt(1),
  designKind: z.enum(["ab", "holdout"]),
  unitKind,
  controlVariantId: id,
  treatmentVariantId: id,
  frozenAt: instant,
  eligibilityFrom: instant,
  assignmentFrom: instant,
  outcomeFrom: instant,
  outcomeToExclusive: instant,
  cutoff: instant,
  primary: z.strictObject({ metricId: id, policyRef: id, minimumLift: threshold }),
  guardrail: z.strictObject({ metricId: id, policyRef: id, maximumIncrease: threshold }),
});

const stamp = { eventId: id, effectiveAt: instant, capturedAt: instant };
const binding = { experimentId: id, unitKind, unitId: id };
const rosterUnit = z.strictObject({ unitId: id, ...stamp });
const assignment = z.strictObject({
  ...binding,
  ...stamp,
  variantId: id,
  method: z.enum(["randomized", "observational", "unknown"]),
});
const exposure = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("matched"),
    ...binding,
    ...stamp,
    variantId: id,
    assignmentEventId: id,
    observedThrough: instant,
  }),
  z.strictObject({ kind: z.literal("unexposed"), observedThrough: instant }),
  z.strictObject({ kind: z.literal("unknown") }),
  z.strictObject({ kind: z.literal("contaminated") }),
]);
const outcome = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("present"), unitId: id, metricId: id, ...stamp }),
  z.strictObject({
    kind: z.literal("absent"),
    unitId: id,
    metricId: id,
    observedThrough: instant,
  }),
  z.strictObject({ kind: z.literal("unknown") }),
]);
const evidenceUnit = z.strictObject({
  unitId: id,
  assignment: assignment.nullable(),
  exposure,
  primary: outcome,
  guardrail: outcome,
});
const requestSchema = z.strictObject({
  design: designSchema,
  source: z.strictObject({
    designFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    cutoff: instant,
    expectedUnits: z.number().int().nonnegative(),
    qualification: z.enum(["qualified-complete", "incomplete", "truncated", "unqualified"]),
    analysisHistory: z.enum(["first-and-only-planned", "repeated", "unknown"]),
    contamination: z.enum(["clear", "detected", "unknown"]),
  }),
  roster: z.custom<readonly unknown[]>((value) => Array.isArray(value)),
  evidence: z.custom<readonly unknown[]>((value) => Array.isArray(value)),
});

type Design = z.output<typeof designSchema>;
type RosterUnit = z.output<typeof rosterUnit>;
type EvidenceUnit = z.output<typeof evidenceUnit>;
type Outcome = z.output<typeof outcome>;
type Request = z.output<typeof requestSchema>;
export type FixedExperimentDesign = z.input<typeof designSchema>;
export type FixedExperimentInput = Omit<z.input<typeof requestSchema>, "roster" | "evidence"> & {
  roster: readonly z.input<typeof rosterUnit>[];
  evidence: readonly z.input<typeof evidenceUnit>[];
};

type Reason =
  | "invalid-request"
  | "invalid-design"
  | "design-or-cutoff-mismatch"
  | "source-unqualified"
  | "unqualified-analysis-look"
  | "contamination"
  | "bounded-limit"
  | "invalid-roster"
  | "invalid-evidence"
  | "incomplete-roster"
  | "duplicate-unit"
  | "duplicate-evidence"
  | "unqualified-assignment"
  | "unqualified-exposure"
  | "unqualified-outcome"
  | "no-observations"
  | "missing-arm";

interface Failure {
  state: "unavailable";
  reason: Reason;
}

interface ArmCounts {
  assigned: number;
  exposed: number;
  primary: number;
  guardrail: number;
}

interface RiskDifference {
  controlRisk: number;
  treatmentRisk: number;
  difference: number;
  interval: { lower: number; upper: number };
}

type EndpointDecision = "criterion-demonstrated" | "criterion-missed" | "inconclusive";

export type FixedExperimentReadout =
  | Failure
  | {
      state: "available";
      definition: typeof definition;
      designKind: Design["designKind"];
      designVersion: number;
      designFingerprint: string;
      eligibilityPolicyRef: string;
      unitKind: Design["unitKind"];
      eligibility: { fromInclusive: string; toExclusive: string };
      assignment: { fromInclusive: string; toExclusive: string; treatmentProbability: number };
      outcomes: { fromInclusive: string; toExclusive: string };
      observationCutoff: string;
      population: "all-qualified-assigned-units";
      contrast: "treatment-minus-control";
      control: ArmCounts & { variantId: string };
      treatment: ArmCounts & { variantId: string };
      primary: RiskDifference & {
        metricId: string;
        minimumLift: number;
        decision: EndpointDecision;
      };
      guardrail: RiskDifference & {
        metricId: string;
        maximumIncrease: number;
        decision: EndpointDecision;
      };
      uncertainty: {
        method: "hoeffding-bonferroni";
        familyAlpha: number;
        endpointAlpha: number;
        look: "one-fixed-cutoff";
      };
    };

function unavailable(reason: Reason): Failure {
  return { state: "unavailable", reason };
}

function validDesign(design: Design): boolean {
  return (
    design.controlVariantId !== design.treatmentVariantId &&
    design.primary.metricId !== design.guardrail.metricId &&
    design.frozenAt < design.eligibilityFrom &&
    design.eligibilityFrom < design.assignmentFrom &&
    design.assignmentFrom < design.outcomeFrom &&
    design.outcomeFrom < design.outcomeToExclusive &&
    design.outcomeToExclusive <= design.cutoff
  );
}

function fingerprint(design: Design): string {
  const payload = JSON.stringify([
    definition,
    familyAlpha,
    design.experimentId,
    design.version,
    design.hypothesisRef,
    design.eligibilityPolicyRef,
    design.randomizationProtocolRef,
    design.assignmentScheme,
    design.treatmentProbability,
    design.designKind,
    design.unitKind,
    design.controlVariantId,
    design.treatmentVariantId,
    design.frozenAt.toString(),
    design.eligibilityFrom.toString(),
    design.assignmentFrom.toString(),
    design.outcomeFrom.toString(),
    design.outcomeToExclusive.toString(),
    design.cutoff.toString(),
    design.primary.metricId,
    design.primary.policyRef,
    design.primary.minimumLift,
    design.guardrail.metricId,
    design.guardrail.policyRef,
    design.guardrail.maximumIncrease,
  ]);
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

/** Compare with a trusted, independently persisted freeze receipt. */
export function fixedExperimentDesignFingerprint(input: unknown): string | null {
  const parsed = designSchema.safeParse(input);
  return parsed.success && validDesign(parsed.data) ? fingerprint(parsed.data) : null;
}

function inWindow(at: bigint, from: bigint, toExclusive: bigint): boolean {
  return at >= from && at < toExclusive;
}

function timely(row: { effectiveAt: bigint; capturedAt: bigint }, cutoff: bigint): boolean {
  return row.effectiveAt <= row.capturedAt && row.capturedAt <= cutoff;
}

type BoundUnit = z.output<typeof assignment>;

function bindsUnit(
  evidence: Pick<BoundUnit, "experimentId" | "unitKind" | "unitId">,
  design: Design,
  unitId: string,
): boolean {
  return (
    evidence.experimentId === design.experimentId &&
    evidence.unitKind === design.unitKind &&
    evidence.unitId === unitId
  );
}

type Arm = "control" | "treatment";

function readArm(design: Design, member: RosterUnit, assigned: BoundUnit): Arm | null {
  if (
    assigned.method !== "randomized" ||
    !bindsUnit(assigned, design, member.unitId) ||
    !inWindow(assigned.effectiveAt, design.assignmentFrom, design.outcomeFrom) ||
    !timely(assigned, design.cutoff) ||
    member.capturedAt > assigned.effectiveAt
  )
    return null;
  if (assigned.variantId === design.controlVariantId) return "control";
  if (assigned.variantId === design.treatmentVariantId) return "treatment";
  return null;
}

function readExposure(
  design: Design,
  assigned: BoundUnit,
  arm: Arm,
  evidence: EvidenceUnit["exposure"],
): Failure | { state: "ready"; exposed: boolean; eventId?: string } {
  if (evidence.kind === "contaminated") return unavailable("contamination");
  if (evidence.kind === "unknown" || evidence.observedThrough !== design.cutoff)
    return unavailable("unqualified-exposure");
  if (evidence.kind === "unexposed") return { state: "ready", exposed: false };
  if (
    evidence.variantId !== assigned.variantId ||
    (design.designKind === "holdout" && arm === "control")
  )
    return unavailable("contamination");
  if (
    !bindsUnit(evidence, design, assigned.unitId) ||
    evidence.assignmentEventId !== assigned.eventId ||
    !inWindow(evidence.effectiveAt, assigned.effectiveAt, design.outcomeToExclusive) ||
    !timely(evidence, design.cutoff)
  )
    return unavailable("unqualified-exposure");
  return { state: "ready", exposed: true, eventId: evidence.eventId };
}

function readOutcome(
  design: Design,
  unitId: string,
  metricId: string,
  evidence: Outcome,
): { present: boolean; eventId?: string } | null {
  if (evidence.kind === "unknown" || evidence.unitId !== unitId || evidence.metricId !== metricId)
    return null;
  if (evidence.kind === "absent")
    return evidence.observedThrough === design.cutoff ? { present: false } : null;
  if (
    !inWindow(evidence.effectiveAt, design.outcomeFrom, design.outcomeToExclusive) ||
    !timely(evidence, design.cutoff)
  )
    return null;
  return { present: true, eventId: evidence.eventId };
}

function rememberEvidence(seen: Set<string>, keys: readonly (string | undefined)[]): boolean {
  for (const key of keys) {
    if (key === undefined) continue;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

function prepareRoster(
  request: Request,
): Failure | { state: "ready"; units: Map<string, RosterUnit>; ids: Set<string> } {
  const units = new Map<string, RosterUnit>();
  const ids = new Set<string>();
  const { design } = request;
  for (const raw of request.roster) {
    const parsed = rosterUnit.safeParse(raw);
    if (!parsed.success) return unavailable("invalid-roster");
    const member = parsed.data;
    if (
      !inWindow(member.effectiveAt, design.eligibilityFrom, design.assignmentFrom) ||
      !timely(member, design.assignmentFrom)
    )
      return unavailable("invalid-roster");
    if (units.has(member.unitId)) return unavailable("duplicate-unit");
    if (!rememberEvidence(ids, [member.eventId])) return unavailable("duplicate-evidence");
    units.set(member.unitId, member);
  }
  return { state: "ready", units, ids };
}

function countUnit(
  design: Design,
  member: RosterUnit,
  unit: EvidenceUnit,
  ids: Set<string>,
  arms: Record<Arm, ArmCounts>,
): Failure | null {
  const { assignment: assigned } = unit;
  if (assigned === null) return unavailable("unqualified-assignment");
  const arm = readArm(design, member, assigned);
  if (arm === null) return unavailable("unqualified-assignment");
  const exposure = readExposure(design, assigned, arm, unit.exposure);
  if (exposure.state === "unavailable") return exposure;
  const primary = readOutcome(design, unit.unitId, design.primary.metricId, unit.primary);
  const guardrail = readOutcome(design, unit.unitId, design.guardrail.metricId, unit.guardrail);
  if (primary === null || guardrail === null) return unavailable("unqualified-outcome");
  if (
    !rememberEvidence(ids, [assigned.eventId, exposure.eventId, primary.eventId, guardrail.eventId])
  )
    return unavailable("duplicate-evidence");

  const counts = arms[arm];
  counts.assigned += 1;
  counts.exposed += Number(exposure.exposed);
  counts.primary += Number(primary.present);
  counts.guardrail += Number(guardrail.present);
  return null;
}

function emptyArm(): ArmCounts {
  return { assigned: 0, exposed: 0, primary: 0, guardrail: 0 };
}

function countArms(request: Request): Failure | { state: "ready"; arms: Record<Arm, ArmCounts> } {
  const roster = prepareRoster(request);
  if (roster.state === "unavailable") return roster;
  const arms = { control: emptyArm(), treatment: emptyArm() };
  const seen = new Set<string>();
  for (const raw of request.evidence) {
    const parsed = evidenceUnit.safeParse(raw);
    if (!parsed.success) return unavailable("invalid-evidence");
    const unit = parsed.data;
    if (seen.has(unit.unitId)) return unavailable("duplicate-unit");
    const member = roster.units.get(unit.unitId);
    if (member === undefined) return unavailable("incomplete-roster");
    const invalid = countUnit(request.design, member, unit, roster.ids, arms);
    if (invalid !== null) return invalid;
    seen.add(unit.unitId);
  }
  return { state: "ready", arms };
}

function riskDifference(
  controlRisk: number,
  treatmentRisk: number,
  radius: number,
): RiskDifference {
  const difference = treatmentRisk - controlRisk;
  return {
    controlRisk,
    treatmentRisk,
    difference,
    interval: { lower: Math.max(-1, difference - radius), upper: Math.min(1, difference + radius) },
  };
}

function primaryDecision(primary: RiskDifference, minimumLift: number): EndpointDecision {
  if (primary.interval.lower >= minimumLift) return "criterion-demonstrated";
  return primary.interval.upper < minimumLift ? "criterion-missed" : "inconclusive";
}

function guardrailDecision(guardrail: RiskDifference, maximumIncrease: number): EndpointDecision {
  if (guardrail.interval.upper <= maximumIncrease) return "criterion-demonstrated";
  return guardrail.interval.lower > maximumIncrease ? "criterion-missed" : "inconclusive";
}

function iso(value: bigint): string {
  return Temporal.Instant.fromEpochNanoseconds(value).toString();
}

function summarize(
  design: Design,
  designFingerprint: string,
  arms: Record<Arm, ArmCounts>,
): FixedExperimentReadout {
  const { control, treatment } = arms;
  if (control.assigned === 0 || treatment.assigned === 0) return unavailable("missing-arm");
  // Hoeffding (1963), Theorem 2 corollary, with two tails per endpoint.
  const inverseSize = 1 / control.assigned + 1 / treatment.assigned;
  const radius = Math.sqrt((inverseSize * Math.log(2 / endpointAlpha)) / 2);
  const primary = riskDifference(
    control.primary / control.assigned,
    treatment.primary / treatment.assigned,
    radius,
  );
  const guardrail = riskDifference(
    control.guardrail / control.assigned,
    treatment.guardrail / treatment.assigned,
    radius,
  );
  return {
    state: "available",
    definition,
    designKind: design.designKind,
    designVersion: design.version,
    designFingerprint,
    eligibilityPolicyRef: design.eligibilityPolicyRef,
    unitKind: design.unitKind,
    eligibility: {
      fromInclusive: iso(design.eligibilityFrom),
      toExclusive: iso(design.assignmentFrom),
    },
    assignment: {
      fromInclusive: iso(design.assignmentFrom),
      toExclusive: iso(design.outcomeFrom),
      treatmentProbability: design.treatmentProbability,
    },
    outcomes: {
      fromInclusive: iso(design.outcomeFrom),
      toExclusive: iso(design.outcomeToExclusive),
    },
    observationCutoff: iso(design.cutoff),
    population: "all-qualified-assigned-units",
    contrast: "treatment-minus-control",
    control: { ...control, variantId: design.controlVariantId },
    treatment: { ...treatment, variantId: design.treatmentVariantId },
    primary: {
      ...primary,
      metricId: design.primary.metricId,
      minimumLift: design.primary.minimumLift,
      decision: primaryDecision(primary, design.primary.minimumLift),
    },
    guardrail: {
      ...guardrail,
      metricId: design.guardrail.metricId,
      maximumIncrease: design.guardrail.maximumIncrease,
      decision: guardrailDecision(guardrail, design.guardrail.maximumIncrease),
    },
    uncertainty: {
      method: "hoeffding-bonferroni",
      familyAlpha,
      endpointAlpha,
      look: "one-fixed-cutoff",
    },
  };
}

function validateSource(request: Request, designFingerprint: string): Failure | null {
  const { source, design, roster, evidence } = request;
  if (source.designFingerprint !== designFingerprint || source.cutoff !== design.cutoff)
    return unavailable("design-or-cutoff-mismatch");
  if (source.qualification !== "qualified-complete") return unavailable("source-unqualified");
  if (source.analysisHistory !== "first-and-only-planned")
    return unavailable("unqualified-analysis-look");
  if (source.contamination !== "clear") return unavailable("contamination");
  if (Math.max(source.expectedUnits, roster.length, evidence.length) > MAX_FIXED_EXPERIMENT_UNITS)
    return unavailable("bounded-limit");
  if (roster.length !== source.expectedUnits || evidence.length !== roster.length)
    return unavailable("incomplete-roster");
  return roster.length === 0 ? unavailable("no-observations") : null;
}

/** Private aggregate kernel. Its source assertions must come from a qualified collector. */
export function computeFixedExperimentReadout(input: unknown): FixedExperimentReadout {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return unavailable("invalid-request");
  const request = parsed.data;
  if (!validDesign(request.design)) return unavailable("invalid-design");
  const designFingerprint = fingerprint(request.design);
  const invalid = validateSource(request, designFingerprint);
  if (invalid !== null) return invalid;
  const counted = countArms(request);
  if (counted.state === "unavailable") return counted;
  return summarize(request.design, designFingerprint, counted.arms);
}
