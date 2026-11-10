import { err, ok, type Result } from "@/types/result";
import {
  type RecordedRoundAllowance,
  type RevisionRoundDeclaration,
  recordedRoundAllowanceSchema,
  revisionRoundDeclarationSchema,
} from "./revisionRoundScopeSchemas";

export type { RecordedRoundAllowance, RevisionRoundDeclaration } from "./revisionRoundScopeSchemas";

export type RoundScopeAssessment = Readonly<{
  projectId: string;
  deliverableId: string;
  roundNumber: number;
  allowanceVersion: number;
  classification: "allowance-unknown" | "contextual-included" | "scope-review-required";
}>;

export function parseRevisionRoundDeclaration(
  input: unknown,
): Result<RevisionRoundDeclaration, "invalid_round_declaration"> {
  const parsed = revisionRoundDeclarationSchema.safeParse(input);
  return parsed.success ? ok(parsed.data) : err("invalid_round_declaration");
}

export function parseRevisionRoundAllowance(
  input: unknown,
): Result<RecordedRoundAllowance, "invalid_round_allowance"> {
  const parsed = recordedRoundAllowanceSchema.safeParse(input);
  return parsed.success ? ok(parsed.data) : err("invalid_round_allowance");
}

// Validated inputs only. Matching supplied terms proves no currentness, authority or durable replay.
export function evaluateRevisionRoundScope(
  round: RevisionRoundDeclaration,
  allowance: RecordedRoundAllowance,
): Result<RoundScopeAssessment, "round_scope_target_conflict" | "round_scope_version_conflict"> {
  if (round.projectId !== allowance.projectId || round.deliverableId !== allowance.deliverableId) {
    return err("round_scope_target_conflict");
  }
  if (round.expectedAllowanceVersion !== allowance.version) {
    return err("round_scope_version_conflict");
  }
  const classification =
    allowance.kind === "unknown"
      ? "allowance-unknown"
      : round.roundNumber <= allowance.includedRounds
        ? "contextual-included"
        : "scope-review-required";
  return ok({
    projectId: round.projectId,
    deliverableId: round.deliverableId,
    roundNumber: round.roundNumber,
    allowanceVersion: allowance.version,
    classification,
  });
}
