import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";

// Each distinct age withdraws at least one deal. The exact denominator grows by at
// most the product of decreasing risk counts, bounded by MAX_DEAL_CLOSE_SUBJECTS!.
export const MAX_DEAL_CLOSE_SUBJECTS = 2_048;
const DECIMAL_PLACES = 9;
const DECIMAL_SCALE = 10n ** BigInt(DECIMAL_PLACES);

const identifier = z
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

const outcomeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("first-qualified-close"),
    cause: z.enum(["won", "lost"]),
    eventId: identifier,
    at: instant,
  }),
  z.strictObject({ kind: z.literal("still-open"), observedThrough: instant }),
  z.strictObject({ kind: z.literal("unknown") }),
]);
const subjectSchema = z.strictObject({
  subjectId: identifier,
  entryBasis: z.enum(["observed-deal-insert", "legacy-baseline"]),
  entryEventId: identifier,
  enteredAt: instant,
  outcome: outcomeSchema,
});
const requestSchema = z.strictObject({
  source: z.strictObject({
    definitionId: identifier,
    completeness: z.enum(["complete", "incomplete", "truncated"]),
    expectedSubjectCount: z.number().int().nonnegative(),
    captureActivatedAt: instant,
  }),
  observationCutoff: instant,
  // Apply the row limit before parsing or copying the subject array.
  subjects: z.custom<readonly unknown[]>((value) => Array.isArray(value)),
});

export type DealCloseSubject = z.input<typeof subjectSchema>;
export type DealCloseIncidenceInput = Omit<z.input<typeof requestSchema>, "subjects"> & {
  subjects: readonly DealCloseSubject[];
};
type Subject = z.output<typeof subjectSchema>;
type Request = z.output<typeof requestSchema>;

interface Withdrawals {
  won: number;
  lost: number;
  rightCensored: number;
}

interface IncidenceStep extends Withdrawals {
  elapsedNanoseconds: string;
  atRiskBefore: number;
  atRiskAfter: number;
  probability: {
    won: string;
    lost: string;
    eventFree: string;
  };
}

type Failure = {
  state: "unavailable";
  reason:
    | "invalid-request"
    | "bounded-limit"
    | "incomplete-source"
    | "membership-count-mismatch"
    | "invalid-subject"
    | "unqualified-origin"
    | "unknown-outcome"
    | "inconsistent-coverage"
    | "duplicate-subject"
    | "duplicate-evidence";
};

export type DealCloseIncidenceResult =
  | Failure
  | {
      state: "available";
      definition: "observed-deal-first-close-aj-v1";
      sourceDefinitionId: string;
      captureActivatedAt: string;
      observationCutoff: string;
      censoring: "administrative-at-shared-cutoff";
      evidence: "empty" | "all-censored" | "no-wins" | "observed-wins";
      subjectCount: number;
      observed: Withdrawals;
      steps: IncidenceStep[];
    };

function emptyWithdrawals(): Withdrawals {
  return { won: 0, lost: 0, rightCensored: 0 };
}

interface Withdrawal {
  state: "qualified";
  age: bigint;
  kind: keyof Withdrawals;
  evidenceIds: string[];
}

function qualify(subject: Subject, activation: bigint, cutoff: bigint): Failure | Withdrawal {
  if (subject.entryBasis !== "observed-deal-insert")
    return { state: "unavailable", reason: "unqualified-origin" };
  const { outcome } = subject;
  if (outcome.kind === "unknown") return { state: "unavailable", reason: "unknown-outcome" };

  const entry = subject.enteredAt.epochNanoseconds;
  const open = outcome.kind === "still-open";
  const exit = (open ? outcome.observedThrough : outcome.at).epochNanoseconds;
  if (entry < activation || entry > exit || exit > cutoff || (open && exit !== cutoff))
    return { state: "unavailable", reason: "inconsistent-coverage" };

  return {
    state: "qualified",
    age: exit - entry,
    kind: open ? "rightCensored" : outcome.cause,
    evidenceIds: open ? [subject.entryEventId] : [subject.entryEventId, outcome.eventId],
  };
}

function recordEvidence(seen: Set<string>, ids: readonly string[]): boolean {
  for (const id of ids) {
    if (seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

type RiskGroups = {
  state: "ready";
  byAge: Map<bigint, Withdrawals>;
  observed: Withdrawals;
};

function groupWithdrawals(request: Request): Failure | RiskGroups {
  const activation = request.source.captureActivatedAt.epochNanoseconds;
  const cutoff = request.observationCutoff.epochNanoseconds;
  const subjects = new Set<string>();
  const evidence = new Set<string>();
  const byAge = new Map<bigint, Withdrawals>();
  const observed = emptyWithdrawals();

  for (const row of request.subjects) {
    const parsed = subjectSchema.safeParse(row);
    if (!parsed.success) return { state: "unavailable", reason: "invalid-subject" };
    const subject = parsed.data;
    const withdrawal = qualify(subject, activation, cutoff);
    if (withdrawal.state === "unavailable") return withdrawal;
    if (subjects.has(subject.subjectId))
      return { state: "unavailable", reason: "duplicate-subject" };
    subjects.add(subject.subjectId);
    if (!recordEvidence(evidence, withdrawal.evidenceIds))
      return { state: "unavailable", reason: "duplicate-evidence" };

    const { age, kind } = withdrawal;
    const counts = byAge.get(age) ?? emptyWithdrawals();
    counts[kind] += 1;
    byAge.set(age, counts);
    observed[kind] += 1;
  }
  return { state: "ready", byAge, observed };
}

interface ExactIncidence {
  denominator: bigint;
  won: bigint;
  lost: bigint;
}

function advance(previous: ExactIncidence, atRisk: number, counts: Withdrawals): ExactIncidence {
  if (counts.won + counts.lost === 0) return previous;
  const risk = BigInt(atRisk);
  const eventFree = previous.denominator - previous.won - previous.lost;
  // Both causes use the same risk set and the event-free mass just before this age.
  return {
    denominator: previous.denominator * risk,
    won: previous.won * risk + eventFree * BigInt(counts.won),
    lost: previous.lost * risk + eventFree * BigInt(counts.lost),
  };
}

function roundPart(numerator: bigint, denominator: bigint): bigint {
  return (2n * numerator * DECIMAL_SCALE + denominator) / (2n * denominator);
}

function decimal(part: bigint): string {
  const fraction = (part % DECIMAL_SCALE).toString().padStart(DECIMAL_PLACES, "0");
  return `${part / DECIMAL_SCALE}.${fraction}`;
}

function probabilities(mass: ExactIncidence): IncidenceStep["probability"] {
  // Round the win and the complement of loss to nearest, half-up. Complementary
  // ties keep both incidences monotone and preserve zero event-free mass exactly.
  const won = roundPart(mass.won, mass.denominator);
  const notLost = roundPart(mass.denominator - mass.lost, mass.denominator);
  return {
    won: decimal(won),
    lost: decimal(DECIMAL_SCALE - notLost),
    eventFree: decimal(notLost - won),
  };
}

function riskTable(byAge: RiskGroups["byAge"], subjectCount: number): IncidenceStep[] {
  const steps: IncidenceStep[] = [];
  let atRisk = subjectCount;
  let mass: ExactIncidence = { denominator: 1n, won: 0n, lost: 0n };
  const ages = [...byAge.entries()].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  for (const [age, counts] of ages) {
    mass = advance(mass, atRisk, counts);
    const remaining = atRisk - counts.won - counts.lost - counts.rightCensored;
    steps.push({
      elapsedNanoseconds: age.toString(),
      atRiskBefore: atRisk,
      ...counts,
      atRiskAfter: remaining,
      probability: probabilities(mass),
    });
    atRisk = remaining;
  }
  return steps;
}

function evidenceState(subjectCount: number, observed: Withdrawals) {
  if (subjectCount === 0) return "empty";
  if (observed.won > 0) return "observed-wins";
  return observed.lost > 0 ? "no-wins" : "all-censored";
}

/**
 * Descriptive Aalen–Johansen baseline in elapsed time since each observed insert.
 * The collector attests complete authorized membership and exact cutoffs from one
 * qualified observation. It supplies stable incarnation and evidence keys and
 * establishes the first transaction-final close or uninterrupted open observation
 * through the cutoff. This kernel checks the declared contract and returns only
 * aggregates. Interpretation assumes censoring does not inform the close process
 * within the pooled population. The curve ends at the last observed age and
 * provides no predictive, calibrated or causal estimate.
 */
export function computeDealCloseIncidence(input: unknown): DealCloseIncidenceResult {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { state: "unavailable", reason: "invalid-request" };
  const request = parsed.data;
  const { source, observationCutoff } = request;
  const subjectCount = request.subjects.length;
  if (
    subjectCount > MAX_DEAL_CLOSE_SUBJECTS ||
    source.expectedSubjectCount > MAX_DEAL_CLOSE_SUBJECTS
  )
    return { state: "unavailable", reason: "bounded-limit" };
  if (source.completeness !== "complete")
    return { state: "unavailable", reason: "incomplete-source" };
  if (subjectCount !== source.expectedSubjectCount)
    return { state: "unavailable", reason: "membership-count-mismatch" };
  if (source.captureActivatedAt.epochNanoseconds > observationCutoff.epochNanoseconds)
    return { state: "unavailable", reason: "inconsistent-coverage" };

  const groups = groupWithdrawals(request);
  if (groups.state === "unavailable") return groups;
  return {
    state: "available",
    definition: "observed-deal-first-close-aj-v1",
    sourceDefinitionId: source.definitionId,
    captureActivatedAt: source.captureActivatedAt.toString(),
    observationCutoff: observationCutoff.toString(),
    censoring: "administrative-at-shared-cutoff",
    evidence: evidenceState(subjectCount, groups.observed),
    subjectCount,
    observed: groups.observed,
    steps: riskTable(groups.byAge, subjectCount),
  };
}
