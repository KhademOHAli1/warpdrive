import { err, ok, type Result } from "@/types/result";
import type { ProjectState } from "./projectLifecycle";

export type AssignmentState =
  | "awaiting-acceptance"
  | "working"
  | "submitted"
  | "internal-review"
  | "changes-requested"
  | "approved"
  | "canceled";
export type AssignmentAction =
  | "record-acceptance"
  | "submit"
  | "begin-review"
  | "request-changes"
  | "resume-work"
  | "approve"
  | "cancel";
type StaffRecordedAcceptance = Readonly<{
  source: "staff-recorded";
  recordedByUserId: string;
  freelancerContactId: string;
  evidenceReference: string;
}>;
type InternalApproval = Readonly<{
  kind: "internal";
  recordedByUserId: string;
  versionReference: string;
}>;
export type AssignmentSnapshot = Readonly<{
  state: AssignmentState;
  revision: number;
  freelancerContactId: string;
  internalOwnerUserId: string;
  versionReference: string | null;
  acceptance: StaffRecordedAcceptance | null;
  approval: InternalApproval | null;
}>;
type CommandBase = Readonly<{ expectedRevision: number; recordedByUserId: string }>;
export type AssignmentCommand = CommandBase &
  (
    | Readonly<{
        action: "record-acceptance";
        freelancerContactId: string;
        evidenceReference: string;
      }>
    | Readonly<{ action: "approve"; reviewedVersionReference: string }>
    | Readonly<{ action: "submit"; submittedVersionReference: string }>
    | Readonly<{ action: "cancel" | "request-changes"; reason: string }>
    | Readonly<{ action: "begin-review" | "resume-work" }>
  );
type AssignmentFailure =
  | "revision_conflict"
  | "invalid_transition"
  | "project_not_active"
  | "actor_required"
  | "reason_required"
  | "acceptance_contact_mismatch"
  | "acceptance_evidence_required"
  | "review_version_conflict"
  | "submission_version_required"
  | "revision_exhausted";
type TransitionReceipt = Readonly<{
  policyVersion: 1;
  action: AssignmentAction;
  from: AssignmentState;
  to: AssignmentState;
  previousRevision: number;
  revision: number;
  recordedByUserId: string;
  reason: string | null;
  previousVersionReference: string | null;
  versionReference: string | null;
  provenance:
    | StaffRecordedAcceptance
    | Readonly<{ source: "staff-recorded"; recordedByUserId: string }>;
}>;

function destination(state: AssignmentState, action: AssignmentAction): AssignmentState | null {
  switch (action) {
    case "record-acceptance":
      return state === "awaiting-acceptance" ? "working" : null;
    case "submit":
      return state === "working" ? "submitted" : null;
    case "begin-review":
      return state === "submitted" ? "internal-review" : null;
    case "request-changes":
      return state === "internal-review" ? "changes-requested" : null;
    case "resume-work":
      return state === "changes-requested" ? "working" : null;
    case "approve":
      return state === "internal-review" ? "approved" : null;
    case "cancel":
      return state === "approved" || state === "canceled" ? null : "canceled";
  }
}

function evidenceFailure(
  current: AssignmentSnapshot,
  command: AssignmentCommand,
): AssignmentFailure | null {
  if (command.recordedByUserId.trim().length === 0) return "actor_required";
  if (command.action === "submit" && command.submittedVersionReference.trim().length === 0)
    return "submission_version_required";
  if (command.action === "record-acceptance") {
    if (command.freelancerContactId !== current.freelancerContactId)
      return "acceptance_contact_mismatch";
    if (command.evidenceReference.trim().length === 0) return "acceptance_evidence_required";
  }
  if (
    (command.action === "cancel" || command.action === "request-changes") &&
    command.reason.trim().length === 0
  ) {
    return "reason_required";
  }
  if (
    command.action === "approve" &&
    command.reviewedVersionReference !== current.versionReference
  ) {
    return "review_version_conflict";
  }
  return null;
}

// Internal domain decision only, not actor authentication, authorization or a persisted CAS.
export function transitionAssignment(
  current: AssignmentSnapshot,
  command: AssignmentCommand,
  projectState: ProjectState,
): Result<Readonly<{ next: AssignmentSnapshot; receipt: TransitionReceipt }>, AssignmentFailure> {
  if (current.revision !== command.expectedRevision) return err("revision_conflict");
  if (projectState !== "active" && command.action !== "cancel") return err("project_not_active");
  const to = destination(current.state, command.action);
  if (to === null) return err("invalid_transition");
  const failure = evidenceFailure(current, command);
  if (failure !== null) return err(failure);
  if (current.revision >= Number.MAX_SAFE_INTEGER) return err("revision_exhausted");
  const revision = current.revision + 1;
  const versionReference =
    command.action === "submit" ? command.submittedVersionReference : current.versionReference;
  const provenance =
    command.action === "record-acceptance"
      ? {
          source: "staff-recorded" as const,
          recordedByUserId: command.recordedByUserId,
          freelancerContactId: command.freelancerContactId,
          evidenceReference: command.evidenceReference,
        }
      : { source: "staff-recorded" as const, recordedByUserId: command.recordedByUserId };
  const next: AssignmentSnapshot = {
    ...current,
    state: to,
    revision,
    versionReference,
    acceptance:
      command.action === "record-acceptance"
        ? {
            source: "staff-recorded",
            recordedByUserId: command.recordedByUserId,
            freelancerContactId: command.freelancerContactId,
            evidenceReference: command.evidenceReference,
          }
        : current.acceptance,
    approval:
      command.action === "approve"
        ? {
            kind: "internal",
            recordedByUserId: command.recordedByUserId,
            versionReference: command.reviewedVersionReference,
          }
        : null,
  };
  return ok({
    next,
    receipt: {
      policyVersion: 1,
      action: command.action,
      from: current.state,
      to,
      previousRevision: current.revision,
      revision,
      recordedByUserId: command.recordedByUserId,
      previousVersionReference: current.versionReference,
      versionReference,
      reason:
        command.action === "cancel" || command.action === "request-changes"
          ? command.reason.trim()
          : null,
      provenance,
    },
  });
}
