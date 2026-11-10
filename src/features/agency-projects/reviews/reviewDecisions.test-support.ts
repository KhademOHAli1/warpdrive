import type { ReviewSnapshot } from "./reviewDecisions";

export const scope = {
  projectId: "cdefabcd-3456-4cde-abcd-345678901abc",
  deliverableId: "defabcde-4567-4def-bcde-456789012abc",
  expectedRevision: 4,
};
export const nativeRecorder = {
  recordedByUserId: "abcdefab-1234-4abc-8def-1234567890ab",
  recordedAt: "2026-11-01T06:00:00Z",
};
export const clientContactId = "bcdefabc-2345-4bcd-9efa-234567890abc";
export const version = "https://example.invalid/Review/Model%2Fv1?variant=A%2Fb#Teil-1";
export const newerVersion = "https://example.invalid/Review/Model%2Fv2?variant=A%2Fb#Teil-1";

export function snapshot(): ReviewSnapshot {
  return {
    projectId: scope.projectId,
    deliverableId: scope.deliverableId,
    revision: 4,
    reviewEpoch: 1,
    reviewOpenedAt: "2026-11-01T05:00:00Z",
    lastRecordedAt: "2026-11-01T05:00:00Z",
    currentVersionReference: version,
    decisions: [],
  };
}

export function internalReview() {
  return {
    ...scope,
    ...nativeRecorder,
    action: "record-internal-review" as const,
    outcome: "approved" as const,
    reviewedVersionReference: version,
    method: "internal-review" as const,
    evidenceReference: "review-note/2026-11-01",
    occurredAt: "2026-11-01T05:50:00Z",
  };
}

export function recordedClientApproval() {
  return {
    ...scope,
    ...nativeRecorder,
    action: "record-client-approval" as const,
    outcome: "approved" as const,
    reviewedVersionReference: version,
    clientContactId,
    method: "email" as const,
    evidenceReference: "client-note/2026-11-01",
    occurredAt: "2026-11-01T09:10:00+03:30",
  };
}

export function changeVersion(expectedRevision = 4) {
  return {
    ...scope,
    ...nativeRecorder,
    expectedRevision,
    action: "change-version" as const,
    versionReference: newerVersion,
    reason: "نسخه جدید / Neue Fassung",
  };
}

export function reopenReview(expectedRevision = 4) {
  return {
    ...scope,
    ...nativeRecorder,
    expectedRevision,
    action: "reopen-review" as const,
    reason: "بررسی دوباره / Erneute Prüfung",
  };
}
