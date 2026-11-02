import type { z } from "zod";
import type { privacyIntakeSchema } from "./caseSchemas";
import type { PrivacyCaseStatus } from "./states";

type Intake = z.output<typeof privacyIntakeSchema>;

export interface PrivacyReviewerCase {
  formatVersion: 1;
  case: {
    id: string;
    kind: Intake["kind"];
    status: PrivacyCaseStatus;
    version: number;
    receivedAt: string;
    dueAt: string | null;
    policyVersion: number | null;
  };
  request: Omit<Intake, "intakeKey">;
  identity: { state: "current" | "review_required" };
  policy: { activeVersion: number | null; generation: number };
}

export type PrivacyReviewerCaseFailure =
  | "invalid_input"
  | "forbidden"
  | "evidence_unavailable"
  | "storage_unavailable";
