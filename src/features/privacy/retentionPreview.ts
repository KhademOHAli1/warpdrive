import { Temporal } from "@js-temporal/polyfill";
import { err, ok, type Result } from "@/types/result";
import {
  type LegacyAuthMailStatus,
  type RetentionMetadataRow,
  type RetentionPreview,
  type RetentionPreviewFailure,
  type RetentionPreviewInput,
  type RetentionRulePreview,
  type RetentionTarget,
  retentionPreviewInputSchema,
} from "./retentionPreviewSchemas";

type HoldState = keyof RetentionPreview["holdCoverage"];
type RuleCounts = {
  matches: number;
  heldMatches: number;
  unknownHoldMatches: number;
  unheldMatches: number;
  noOpMatches: number;
};
type RuleAccumulator = Omit<RetentionRulePreview, keyof RuleCounts> & RuleCounts;
const HOLD_MATCH_KEY = {
  held: "heldMatches",
  unknown: "unknownHoldMatches",
  none: "unheldMatches",
} as const;
const UNIQUE_MATCH_KEY = { held: "held", unknown: "unknownHold", none: "unheld" } as const;
const BODY_STATUSES: readonly LegacyAuthMailStatus[] = ["sent", "captured", "cancelled"];
const MAIL_METADATA_STATUSES: readonly LegacyAuthMailStatus[] = [...BODY_STATUSES, "failed"];

function readInput(input: unknown) {
  try {
    return retentionPreviewInputSchema.safeParse(input);
  } catch {
    // A hostile in-memory property accessor must not leak its exception or content.
    return null;
  }
}

function createRule(
  target: RetentionTarget,
  days: 7 | 180,
  before: string,
  statuses: readonly LegacyAuthMailStatus[] | null,
): RuleAccumulator {
  return {
    target,
    anchor: "created_at",
    period: { days },
    comparison: "strictly_before",
    statuses: statuses === null ? null : [...statuses],
    before,
    matches: 0,
    heldMatches: 0,
    unknownHoldMatches: 0,
    unheldMatches: 0,
    noOpMatches: 0,
  };
}

function createRules(cutoffs: RetentionPreviewInput["cutoffs"]) {
  return [
    createRule("auth_mail_body", 7, cutoffs.authBodyBefore, BODY_STATUSES),
    createRule("auth_mail_metadata", 180, cutoffs.authMetadataBefore, MAIL_METADATA_STATUSES),
    createRule("auth_security_metadata", 180, cutoffs.authMetadataBefore, null),
  ];
}

function holdState(row: RetentionMetadataRow): HoldState {
  if (row.holds === undefined || row.holds === null) return "unknown";
  return row.holds.length === 0 ? "none" : "held";
}

function matchesRule(row: RetentionMetadataRow, rule: RuleAccumulator): boolean {
  if ((row.store === "auth_security_events") !== (rule.target === "auth_security_metadata"))
    return false;
  if (
    row.store === "auth_mail_outbox" &&
    (rule.statuses === null || !rule.statuses.includes(row.status))
  )
    return false;
  return (
    Temporal.Instant.compare(
      Temporal.Instant.from(row.createdAt),
      Temporal.Instant.from(rule.before),
    ) < 0
  );
}

function countMatches(
  row: RetentionMetadataRow,
  rules: RuleAccumulator[],
  hold: HoldState,
): boolean {
  let matched = false;
  for (const rule of rules) {
    if (!matchesRule(row, rule)) continue;
    matched = true;
    rule.matches++;
    rule[HOLD_MATCH_KEY[hold]]++;
    if (rule.target === "auth_mail_body" && row.store === "auth_mail_outbox" && !row.bodyPresent)
      rule.noOpMatches++;
  }
  return matched;
}

// Counts describe supplied metadata only. They grant no execution, activation or live hold proof.
export function buildRetentionPreview(
  input: unknown,
  signal: AbortSignal,
): Result<RetentionPreview, RetentionPreviewFailure> {
  signal.throwIfAborted();
  const parsed = readInput(input);
  signal.throwIfAborted();
  if (parsed === null || !parsed.success) return err("invalid_input" as const);
  const request = parsed.data;
  const rules = createRules(request.cutoffs);
  const holdCoverage = { held: 0, unknown: 0, none: 0 };
  const uniqueMatches = { total: 0, held: 0, unknownHold: 0, unheld: 0 };
  for (const row of request.rows) {
    signal.throwIfAborted();
    const hold = holdState(row);
    holdCoverage[hold]++;
    if (countMatches(row, rules, hold)) {
      uniqueMatches.total++;
      uniqueMatches[UNIQUE_MATCH_KEY[hold]]++;
    }
  }
  signal.throwIfAborted();
  return ok({
    formatVersion: 1,
    executable: false,
    scope: "supplied_metadata_only",
    asOf: request.asOf,
    cutoffs: request.cutoffs,
    legacyDefaults: { authBodyDays: 7, authMetadataDays: 180 },
    sampleRows: request.rows.length,
    holdCoverage,
    rules,
    uniqueMatches,
    blockers: holdCoverage.unknown > 0 ? ["unknown_hold_data"] : [],
  });
}
