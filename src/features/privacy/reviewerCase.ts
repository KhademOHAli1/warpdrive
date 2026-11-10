import type { Db } from "@/db/client";
import { err, type Result } from "@/types/result";
import type { PrivacyActor } from "./permissions";
import type { PrivacyReviewerCase, PrivacyReviewerCaseFailure } from "./reviewerCaseTypes";

// Typed denial scaffold only. Native assertion RED must precede the reader implementation.
export async function readPrivacyReviewerCase(
  _db: Db,
  _actor: PrivacyActor,
  _input: unknown,
  signal: AbortSignal,
): Promise<Result<PrivacyReviewerCase, PrivacyReviewerCaseFailure>> {
  signal.throwIfAborted();
  return Promise.resolve(err("evidence_unavailable"));
}
