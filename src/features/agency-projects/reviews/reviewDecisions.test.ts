import { describe, expect, it } from "vitest";
import { applyReviewCommand, currentReviewApprovals } from "./reviewDecisions";
import {
  clientContactId,
  internalReview,
  nativeRecorder,
  newerVersion,
  recordedClientApproval,
  scope,
  snapshot,
  version,
} from "./reviewDecisions.test-support";

describe("recorded review decisions and conflicts", () => {
  it("records exact internal approval provenance without changing its input", () => {
    const current = Object.freeze({ ...snapshot(), decisions: Object.freeze([]) });
    const result = applyReviewCommand(current, internalReview());
    expect(result).toMatchObject({
      ok: true,
      value: {
        snapshot: {
          revision: 5,
          reviewEpoch: 1,
          lastRecordedAt: nativeRecorder.recordedAt,
          currentVersionReference: version,
          decisions: [
            {
              kind: "internal-review",
              outcome: "approved",
              reviewedVersionReference: version,
              recordedByUserId: nativeRecorder.recordedByUserId,
              method: "internal-review",
              evidenceReference: "review-note/2026-11-01",
              occurredAt: "2026-11-01T05:50:00Z",
              recordedAt: nativeRecorder.recordedAt,
              reviewEpoch: 1,
              recordedAtRevision: 5,
            },
          ],
        },
        receipt: {
          policyVersion: 1,
          action: "record-internal-review",
          projectId: scope.projectId,
          deliverableId: scope.deliverableId,
          previousRevision: 4,
          revision: 5,
          previousReviewEpoch: 1,
          reviewEpoch: 1,
          previousReviewOpenedAt: "2026-11-01T05:00:00Z",
          reviewOpenedAt: "2026-11-01T05:00:00Z",
          previousRecordedAt: "2026-11-01T05:00:00Z",
          previousVersionReference: version,
          versionReference: version,
          ...nativeRecorder,
          reason: null,
        },
      },
    });
    expect(current).toEqual({ ...snapshot(), decisions: [] });
    if (!result.ok) return;
    expect(currentReviewApprovals(result.value.snapshot)).toEqual({
      internal: result.value.snapshot.decisions,
      recordedClient: [],
    });
  });

  it("keeps staff-recorded client approval separate from internal review and external authentication", () => {
    const result = applyReviewCommand(snapshot(), recordedClientApproval());
    expect(result).toMatchObject({
      ok: true,
      value: {
        snapshot: {
          lastRecordedAt: nativeRecorder.recordedAt,
          decisions: [
            {
              kind: "staff-recorded-client-approval",
              outcome: "approved",
              reviewedVersionReference: version,
              recordedByUserId: nativeRecorder.recordedByUserId,
              clientContactId,
              method: "email",
              evidenceReference: "client-note/2026-11-01",
              occurredAt: "2026-11-01T09:10:00+03:30",
              recordedAt: nativeRecorder.recordedAt,
              reviewEpoch: 1,
              recordedAtRevision: 5,
            },
          ],
        },
        receipt: {
          policyVersion: 1,
          action: "record-client-approval",
          projectId: scope.projectId,
          deliverableId: scope.deliverableId,
          previousRevision: 4,
          revision: 5,
          previousReviewEpoch: 1,
          reviewEpoch: 1,
          previousReviewOpenedAt: "2026-11-01T05:00:00Z",
          reviewOpenedAt: "2026-11-01T05:00:00Z",
          previousRecordedAt: "2026-11-01T05:00:00Z",
          previousVersionReference: version,
          versionReference: version,
          ...nativeRecorder,
          reason: null,
        },
      },
    });
    if (!result.ok) return;
    expect(currentReviewApprovals(result.value.snapshot)).toEqual({
      internal: [],
      recordedClient: result.value.snapshot.decisions,
    });
    expect(result.value.snapshot.decisions[0]).not.toHaveProperty("authenticatedClient");
    expect(result.value.snapshot.decisions[0]).not.toHaveProperty("signature");
  });

  it("retains distinct records for multiple clients instead of inferring universal approval", () => {
    const first = applyReviewCommand(snapshot(), recordedClientApproval());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = applyReviewCommand(first.value.snapshot, {
      ...recordedClientApproval(),
      expectedRevision: 5,
      clientContactId: "efabcdef-5678-4abc-8def-567890123abc",
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(currentReviewApprovals(second.value.snapshot).recordedClient).toHaveLength(2);
    expect(currentReviewApprovals(second.value.snapshot).internal).toEqual([]);
    expect(currentReviewApprovals(second.value.snapshot)).not.toHaveProperty("allClientsApproved");
  });

  it("gives expected-revision conflicts precedence and fences replay", () => {
    expect(
      applyReviewCommand(snapshot(), {
        ...internalReview(),
        expectedRevision: 3,
        reviewedVersionReference: newerVersion,
      }),
    ).toEqual({ ok: false, error: "revision_conflict" });
    const first = applyReviewCommand(snapshot(), internalReview());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(applyReviewCommand(first.value.snapshot, internalReview())).toEqual({
      ok: false,
      error: "revision_conflict",
    });
  });

  it.each(["projectId", "deliverableId"] as const)(
    "rejects a decision for a different %s",
    (field) => {
      expect(
        applyReviewCommand(snapshot(), {
          ...internalReview(),
          [field]: "fabcdefa-6789-4bcd-9efa-678901234abc",
        }),
      ).toEqual({ ok: false, error: "review_target_mismatch" });
    },
  );

  it("compares the external version reference exactly, without URL normalization", () => {
    expect(
      applyReviewCommand(snapshot(), {
        ...internalReview(),
        reviewedVersionReference: version.replace("%2F", "%2f"),
      }),
    ).toEqual({ ok: false, error: "review_version_conflict" });
  });
});
