import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
import { isTimeZone } from "@/features/i18n/preferences";

export const MAX_COHORT_SUBJECTS = 10_000;

// The longest elapsed interval between two supported Temporal instants.
const MAX_ELAPSED_NANOSECONDS = 17_280_000_000_000_000_000_000n;
const label = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => value === value.trim());
const instant = z
  .string()
  .max(80)
  .datetime({ offset: true })
  .transform((value, context) => {
    try {
      return Temporal.Instant.from(value);
    } catch {
      context.addIssue({ code: "custom", message: "Invalid exact instant" });
      return z.NEVER;
    }
  });

const elapsed = z
  .string()
  .refine(
    (value) =>
      value.length <= 23 &&
      value === value.trim() &&
      /^[1-9][0-9]*$/.test(value) &&
      BigInt(value) <= MAX_ELAPSED_NANOSECONDS,
  );
const entryBasis = z.enum(["observed-deal-insert", "qualified-acquisition"]);
const outcomeBasis = z.enum(["qualified-win", "qualified-purchase"]);
const outcomeForEntry: Record<z.infer<typeof entryBasis>, z.infer<typeof outcomeBasis>> = {
  "observed-deal-insert": "qualified-win",
  "qualified-acquisition": "qualified-purchase",
};

const outcome = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("event"), basis: outcomeBasis, eventId: label, at: instant }),
  z.strictObject({ kind: z.literal("no-event"), basis: outcomeBasis, observedThrough: instant }),
  z.strictObject({ kind: z.literal("unknown") }),
]);
const subjectSchema = z.strictObject({
  subjectId: label,
  bucketId: label,
  entryBasis,
  entryEventId: label,
  enteredAt: instant,
  outcome,
});
const requestSchema = z.strictObject({
  source: z.strictObject({
    definitionId: label,
    completeness: z.enum(["complete", "incomplete"]),
    entryBasis,
    outcomeBasis,
  }),
  calendar: z.enum(["gregory", "persian"]),
  timeZone: label.refine(isTimeZone),
  observationCutoff: instant,
  horizon: z.strictObject({ id: label, elapsedNanoseconds: elapsed }),
  subjects: z.custom<readonly unknown[]>((value) => Array.isArray(value)),
});

export type CohortSubject = z.input<typeof subjectSchema>;
export type EqualAgeCohortInput = Omit<z.input<typeof requestSchema>, "subjects"> & {
  subjects: readonly CohortSubject[];
};
type Request = z.output<typeof requestSchema>;
type Subject = z.output<typeof subjectSchema>;

interface EntryWitness {
  subjectId: string;
  entryEventId: string;
  enteredAt: string;
}
interface OutcomeWitness {
  eventId: string;
  at: string;
  elapsedNanoseconds: string;
}
export type CohortContributor = EntryWitness &
  (
    | { status: "not-yet-mature" }
    | { status: "mature-unknown" }
    | { status: "converted"; conversion: OutcomeWitness }
    | {
        status: "no-conversion";
        evidence: { kind: "no-event" } | ({ kind: "after-horizon" } & OutcomeWitness);
      }
  );

export interface EqualAgeCohort {
  bucketId: string;
  entryCount: number;
  notYetMatureCount: number;
  matureUnknownCount: number;
  matureNoConversionCount: number;
  // Confirmed conversions and all mature entrants, even when the ratio is unavailable.
  numerator: number;
  denominator: number;
  comparison:
    | { state: "available" }
    | { state: "unavailable"; reason: "no-mature-subjects" | "mature-history-unknown" };
  contributors: CohortContributor[];
}

type Failure = {
  state: "unavailable";
  reason:
    | "invalid-request"
    | "bounded-limit"
    | "incomplete-source"
    | "mixed-basis"
    | "invalid-subject"
    | "inconsistent-source"
    | "conflicting-subject"
    | "conflicting-evidence";
};
export type EqualAgeCohortResult =
  | Failure
  | {
      state: "available";
      definitionId: string;
      entryBasis: Request["source"]["entryBasis"];
      outcomeBasis: Request["source"]["outcomeBasis"];
      calendar: Request["calendar"];
      timeZone: string;
      observationCutoff: string;
      horizon: Request["horizon"];
      uniqueSubjectCount: number;
      duplicateDeliveries: number;
      cohorts: EqualAgeCohort[];
    };

function validSubject(subject: Subject, request: Request): Failure | null {
  const { source, observationCutoff: cutoff } = request;
  if (subject.entryBasis !== source.entryBasis)
    return { state: "unavailable", reason: "mixed-basis" };
  if (Temporal.Instant.compare(subject.enteredAt, cutoff) > 0)
    return { state: "unavailable", reason: "inconsistent-source" };
  const { outcome } = subject;
  if (outcome.kind === "unknown") return null;
  if (outcome.basis !== source.outcomeBasis) return { state: "unavailable", reason: "mixed-basis" };
  if (outcome.kind === "no-event") {
    return outcome.observedThrough.equals(cutoff)
      ? null
      : { state: "unavailable", reason: "inconsistent-source" };
  }
  if (
    Temporal.Instant.compare(outcome.at, subject.enteredAt) < 0 ||
    Temporal.Instant.compare(outcome.at, cutoff) > 0
  )
    return { state: "unavailable", reason: "inconsistent-source" };
  return null;
}

function sameOutcome(left: Subject["outcome"], right: Subject["outcome"]): boolean {
  if (left.kind === "event" && right.kind === "event") {
    return left.basis === right.basis && left.eventId === right.eventId && left.at.equals(right.at);
  }
  if (left.kind === "no-event" && right.kind === "no-event") {
    return left.basis === right.basis && left.observedThrough.equals(right.observedThrough);
  }
  return left.kind === "unknown" && right.kind === "unknown";
}

function sameSubject(left: Subject, right: Subject): boolean {
  return (
    left.bucketId === right.bucketId &&
    left.entryBasis === right.entryBasis &&
    left.entryEventId === right.entryEventId &&
    left.enteredAt.equals(right.enteredAt) &&
    sameOutcome(left.outcome, right.outcome)
  );
}

interface EvidenceOwner {
  subjectId: string;
  at: Temporal.Instant;
}

function recordEvidence(
  index: Map<string, EvidenceOwner>,
  eventId: string,
  subjectId: string,
  at: Temporal.Instant,
): boolean {
  const prior = index.get(eventId);
  if (prior !== undefined) return prior.subjectId === subjectId && prior.at.equals(at);
  index.set(eventId, { subjectId, at });
  return true;
}

function recordSubjectEvidence(subject: Subject, index: Map<string, EvidenceOwner>): boolean {
  if (!recordEvidence(index, subject.entryEventId, subject.subjectId, subject.enteredAt))
    return false;
  const { outcome } = subject;
  return (
    outcome.kind !== "event" ||
    recordEvidence(index, outcome.eventId, subject.subjectId, outcome.at)
  );
}

function prepareSubjects(
  request: Request,
): Failure | { state: "available"; subjects: Subject[]; duplicateDeliveries: number } {
  const subjects = new Map<string, Subject>();
  const evidence = new Map<string, EvidenceOwner>();
  let duplicateDeliveries = 0;
  for (const row of request.subjects) {
    const parsed = subjectSchema.safeParse(row);
    if (!parsed.success) return { state: "unavailable", reason: "invalid-subject" };
    const subject = parsed.data;
    const invalid = validSubject(subject, request);
    if (invalid !== null) return invalid;
    const prior = subjects.get(subject.subjectId);
    if (prior !== undefined) {
      if (!sameSubject(prior, subject))
        return { state: "unavailable", reason: "conflicting-subject" };
      duplicateDeliveries += 1;
      continue;
    }
    if (!recordSubjectEvidence(subject, evidence))
      return { state: "unavailable", reason: "conflicting-evidence" };
    subjects.set(subject.subjectId, subject);
  }
  return { state: "available", subjects: [...subjects.values()], duplicateDeliveries };
}

function classify(subject: Subject, cutoff: bigint, horizon: bigint): CohortContributor {
  const entry = {
    subjectId: subject.subjectId,
    entryEventId: subject.entryEventId,
    enteredAt: subject.enteredAt.toString(),
  };
  const origin = subject.enteredAt.epochNanoseconds;
  if (cutoff - origin < horizon) return { ...entry, status: "not-yet-mature" };
  const { outcome } = subject;
  if (outcome.kind === "unknown") return { ...entry, status: "mature-unknown" };
  if (outcome.kind === "no-event")
    return { ...entry, status: "no-conversion", evidence: { kind: "no-event" } };
  const elapsedNanoseconds = outcome.at.epochNanoseconds - origin;
  const witness = {
    eventId: outcome.eventId,
    at: outcome.at.toString(),
    elapsedNanoseconds: elapsedNanoseconds.toString(),
  };
  return elapsedNanoseconds <= horizon
    ? { ...entry, status: "converted", conversion: witness }
    : { ...entry, status: "no-conversion", evidence: { kind: "after-horizon", ...witness } };
}

function comparison(denominator: number, matureUnknownCount: number): EqualAgeCohort["comparison"] {
  if (denominator === 0) return { state: "unavailable", reason: "no-mature-subjects" };
  if (matureUnknownCount > 0) return { state: "unavailable", reason: "mature-history-unknown" };
  return { state: "available" };
}

function summarize(bucketId: string, contributors: CohortContributor[]): EqualAgeCohort {
  const counts: Record<CohortContributor["status"], number> = {
    "not-yet-mature": 0,
    "mature-unknown": 0,
    "no-conversion": 0,
    converted: 0,
  };
  for (const item of contributors) counts[item.status] += 1;
  const denominator = contributors.length - counts["not-yet-mature"];
  return {
    bucketId,
    entryCount: contributors.length,
    notYetMatureCount: counts["not-yet-mature"],
    matureUnknownCount: counts["mature-unknown"],
    matureNoConversionCount: counts["no-conversion"],
    numerator: counts.converted,
    denominator,
    comparison: comparison(denominator, counts["mature-unknown"]),
    contributors,
  };
}

function compareId(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function groupCohorts(subjects: Subject[], cutoff: bigint, horizon: bigint): EqualAgeCohort[] {
  const buckets = new Map<string, CohortContributor[]>();
  for (const subject of subjects.sort((left, right) =>
    compareId(left.subjectId, right.subjectId),
  )) {
    const item = classify(subject, cutoff, horizon);
    const bucket = buckets.get(subject.bucketId);
    if (bucket === undefined) buckets.set(subject.bucketId, [item]);
    else bucket.push(item);
  }
  return [...buckets.entries()]
    .sort(([left], [right]) => compareId(left, right))
    .map(([bucketId, contributors]) => summarize(bucketId, contributors));
}

/**
 * The collector establishes complete authorized cohort membership and which events were known
 * at the cutoff. It namespaces stable subject and event keys by producer/source. A deal key
 * binds its captured incarnation even when a record UUID is reused. Supply a qualified earliest
 * outcome or a no-event observation for the same outcome basis. The collector establishes
 * continuous coverage from entry through the shared cutoff for a no-event observation. Use
 * unknown when outcome history cannot be qualified. An observed deal insert uses its captured
 * instant. Baselines and imported creation dates provide no origin.
 * Calendar, zone and bucket assignment are collector metadata. The kernel uses exact elapsed
 * instants, with inclusive maturity and outcome boundaries, and cannot prove source coverage.
 */
export function computeEqualAgeCohorts(input: unknown): EqualAgeCohortResult {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { state: "unavailable", reason: "invalid-request" };
  const request = parsed.data;
  if (request.subjects.length > MAX_COHORT_SUBJECTS)
    return { state: "unavailable", reason: "bounded-limit" };
  const { source, observationCutoff, horizon } = request;
  if (source.completeness !== "complete")
    return { state: "unavailable", reason: "incomplete-source" };
  if (outcomeForEntry[source.entryBasis] !== source.outcomeBasis)
    return { state: "unavailable", reason: "mixed-basis" };
  const prepared = prepareSubjects(request);
  if (prepared.state === "unavailable") return prepared;
  return {
    state: "available",
    definitionId: source.definitionId,
    entryBasis: source.entryBasis,
    outcomeBasis: source.outcomeBasis,
    calendar: request.calendar,
    timeZone: request.timeZone,
    observationCutoff: observationCutoff.toString(),
    horizon,
    uniqueSubjectCount: prepared.subjects.length,
    duplicateDeliveries: prepared.duplicateDeliveries,
    cohorts: groupCohorts(
      prepared.subjects,
      observationCutoff.epochNanoseconds,
      BigInt(horizon.elapsedNanoseconds),
    ),
  };
}
