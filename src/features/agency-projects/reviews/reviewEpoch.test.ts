import { describe, expect, it } from "vitest";
import { applyReviewCommand, currentReviewApprovals } from "./reviewDecisions";
import {
  changeVersion,
  internalReview,
  nativeRecorder,
  newerVersion,
  recordedClientApproval,
  reopenReview,
  scope,
  snapshot,
  version,
} from "./reviewDecisions.test-support";

describe("version and review epoch history", () => {
  it("preserves old decisions when a newer version starts a fresh review epoch", () => {
    const approved = applyReviewCommand(snapshot(), internalReview());
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    const historical = structuredClone(approved.value.snapshot.decisions);
    const reason = "نسخه جدید / Neue Fassung\nشرح تغییر / Änderungsgrund";
    const changed = applyReviewCommand(approved.value.snapshot, { ...changeVersion(5), reason });
    expect(changed).toMatchObject({
      ok: true,
      value: {
        snapshot: {
          revision: 6,
          reviewEpoch: 2,
          reviewOpenedAt: nativeRecorder.recordedAt,
          lastRecordedAt: nativeRecorder.recordedAt,
          currentVersionReference: newerVersion,
          decisions: historical,
        },
        receipt: {
          policyVersion: 1,
          action: "change-version",
          projectId: scope.projectId,
          deliverableId: scope.deliverableId,
          previousRevision: 5,
          revision: 6,
          previousReviewEpoch: 1,
          reviewEpoch: 2,
          previousReviewOpenedAt: "2026-11-01T05:00:00Z",
          reviewOpenedAt: nativeRecorder.recordedAt,
          previousRecordedAt: nativeRecorder.recordedAt,
          previousVersionReference: version,
          versionReference: newerVersion,
          ...nativeRecorder,
          reason,
        },
      },
    });
    if (!changed.ok) return;
    expect(currentReviewApprovals(changed.value.snapshot)).toEqual({
      internal: [],
      recordedClient: [],
    });
    expect(approved.value.snapshot.decisions).toEqual(historical);
  });

  it("reopens the same version without inheriting its earlier recorded client approval", () => {
    const approved = applyReviewCommand(snapshot(), recordedClientApproval());
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    const reason = "بررسی دوباره / Erneute Prüfung\nتأیید قبلی محفوظ می‌ماند";
    const reopened = applyReviewCommand(approved.value.snapshot, { ...reopenReview(5), reason });
    expect(reopened).toMatchObject({
      ok: true,
      value: {
        snapshot: {
          revision: 6,
          reviewEpoch: 2,
          reviewOpenedAt: nativeRecorder.recordedAt,
          lastRecordedAt: nativeRecorder.recordedAt,
          currentVersionReference: version,
          decisions: approved.value.snapshot.decisions,
        },
        receipt: {
          policyVersion: 1,
          action: "reopen-review",
          projectId: scope.projectId,
          deliverableId: scope.deliverableId,
          previousRevision: 5,
          revision: 6,
          previousReviewEpoch: 1,
          reviewEpoch: 2,
          previousReviewOpenedAt: "2026-11-01T05:00:00Z",
          reviewOpenedAt: nativeRecorder.recordedAt,
          previousRecordedAt: nativeRecorder.recordedAt,
          previousVersionReference: version,
          versionReference: version,
          ...nativeRecorder,
          reason,
        },
      },
    });
    if (!reopened.ok) return;
    expect(currentReviewApprovals(reopened.value.snapshot)).toEqual({
      internal: [],
      recordedClient: [],
    });
  });

  it("requires an explicit reopen rather than relabeling an unchanged version", () => {
    expect(
      applyReviewCommand(snapshot(), { ...changeVersion(), versionReference: version }),
    ).toEqual({ ok: false, error: "version_unchanged" });
  });

  it("makes approve/change ordering deterministic while leaving actual DB races unqualified", () => {
    const approvalFirst = applyReviewCommand(snapshot(), internalReview());
    const versionFirst = applyReviewCommand(snapshot(), changeVersion());
    expect(approvalFirst.ok).toBe(true);
    expect(versionFirst.ok).toBe(true);
    if (!approvalFirst.ok || !versionFirst.ok) return;
    expect(applyReviewCommand(approvalFirst.value.snapshot, changeVersion())).toEqual({
      ok: false,
      error: "revision_conflict",
    });
    expect(applyReviewCommand(versionFirst.value.snapshot, internalReview())).toEqual({
      ok: false,
      error: "revision_conflict",
    });
  });

  it("rejects revision overflow for every admitted mutation without changing history", () => {
    const approved = applyReviewCommand(snapshot(), internalReview());
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    const current = { ...approved.value.snapshot, revision: Number.MAX_SAFE_INTEGER };
    const before = structuredClone(current);
    for (const command of [
      internalReview(),
      recordedClientApproval(),
      changeVersion(),
      reopenReview(),
    ]) {
      expect(
        applyReviewCommand(current, { ...command, expectedRevision: Number.MAX_SAFE_INTEGER }),
      ).toEqual({ ok: false, error: "revision_exhausted" });
    }
    expect(current).toEqual(before);
  });

  it("rejects epoch overflow on version change and reopen before invalidating history", () => {
    const approved = applyReviewCommand(snapshot(), internalReview());
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    const current = { ...approved.value.snapshot, reviewEpoch: Number.MAX_SAFE_INTEGER };
    const before = structuredClone(current);
    for (const command of [changeVersion(), reopenReview()]) {
      expect(
        applyReviewCommand(current, { ...command, expectedRevision: current.revision }),
      ).toEqual({ ok: false, error: "review_epoch_exhausted" });
    }
    expect(current).toEqual(before);
  });

  it("can still record evidence at the maximum epoch because recording does not advance it", () => {
    expect(
      applyReviewCommand({ ...snapshot(), reviewEpoch: Number.MAX_SAFE_INTEGER }, internalReview()),
    ).toMatchObject({
      ok: true,
      value: {
        snapshot: { revision: 5, reviewEpoch: Number.MAX_SAFE_INTEGER },
        receipt: {
          previousReviewEpoch: Number.MAX_SAFE_INTEGER,
          reviewEpoch: Number.MAX_SAFE_INTEGER,
        },
      },
    });
  });

  it("does not reassign late old client or internal evidence to a reopened or changed epoch", () => {
    for (const epochCommand of [reopenReview(), changeVersion()]) {
      const opened = applyReviewCommand(snapshot(), epochCommand);
      expect(opened.ok).toBe(true);
      if (!opened.ok) return;
      for (const oldEvidence of [recordedClientApproval(), internalReview()]) {
        expect(
          applyReviewCommand(opened.value.snapshot, {
            ...oldEvidence,
            expectedRevision: 5,
            reviewedVersionReference: opened.value.snapshot.currentVersionReference,
          }),
        ).toEqual({ ok: false, error: "review_occurrence_before_epoch" });
      }
    }
  });

  it("compares the epoch opening at nanosecond precision and admits an occurrence at that exact instant", () => {
    const current = {
      ...snapshot(),
      reviewOpenedAt: "2026-11-01T06:00:00.000000001Z",
      lastRecordedAt: "2026-11-01T06:00:00.000000001Z",
    };
    const command = {
      ...recordedClientApproval(),
      recordedAt: "2026-11-01T06:00:00.000000002Z",
      occurredAt: "2026-11-01T09:30:00.000000000+03:30",
    };
    expect(applyReviewCommand(current, command)).toEqual({
      ok: false,
      error: "review_occurrence_before_epoch",
    });
    expect(
      applyReviewCommand(current, { ...command, occurredAt: "2026-11-01T09:30:00.000000001+03:30" })
        .ok,
    ).toBe(true);
  });

  it("does not resurrect v1 approval after v1 to v2 to v1 or attach the old fact to its new epoch", () => {
    const approved = applyReviewCommand(snapshot(), recordedClientApproval());
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    const changed = applyReviewCommand(approved.value.snapshot, changeVersion(5));
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    const returned = applyReviewCommand(changed.value.snapshot, {
      ...changeVersion(6),
      versionReference: version,
      recordedAt: "2026-11-01T06:10:00Z",
    });
    expect(returned.ok).toBe(true);
    if (!returned.ok) return;
    expect(returned.value.snapshot.decisions).toEqual(approved.value.snapshot.decisions);
    expect(currentReviewApprovals(returned.value.snapshot)).toEqual({
      internal: [],
      recordedClient: [],
    });
    expect(
      applyReviewCommand(returned.value.snapshot, {
        ...recordedClientApproval(),
        expectedRevision: 7,
        recordedAt: "2026-11-01T06:11:00Z",
      }),
    ).toEqual({ ok: false, error: "review_occurrence_before_epoch" });
  });
});
