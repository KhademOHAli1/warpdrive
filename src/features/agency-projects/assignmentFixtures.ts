import type {
  AssignmentAction,
  AssignmentCommand,
  AssignmentSnapshot,
  AssignmentState,
} from "./assignmentLifecycle";

export const staffUserId = "11111111-1111-4111-8111-111111111111";
export const freelancerContactId = "22222222-2222-4222-8222-222222222222";
export const acceptance = Object.freeze({
  source: "staff-recorded" as const,
  recordedByUserId: staffUserId,
  freelancerContactId,
  evidenceReference: "call-note-42",
});

export function snapshot(state: AssignmentState = "awaiting-acceptance"): AssignmentSnapshot {
  return {
    state,
    revision: 2,
    freelancerContactId,
    internalOwnerUserId: staffUserId,
    versionReference: state === "awaiting-acceptance" ? null : "model-v1",
    acceptance: state === "awaiting-acceptance" ? null : acceptance,
    approval:
      state === "approved"
        ? { kind: "internal", recordedByUserId: staffUserId, versionReference: "model-v1" }
        : null,
  };
}

export function command(action: AssignmentAction): AssignmentCommand {
  const base = { expectedRevision: 2, recordedByUserId: staffUserId };
  switch (action) {
    case "record-acceptance":
      return { ...base, action, freelancerContactId, evidenceReference: "call-note-42" };
    case "approve":
      return { ...base, action, reviewedVersionReference: "model-v1" };
    case "request-changes":
    case "cancel":
      return { ...base, action, reason: "بازبینی / Kundenkorrektur" };
    case "submit":
      return { ...base, action, submittedVersionReference: "model-v1" };
    case "begin-review":
    case "resume-work":
      return { ...base, action };
  }
}
