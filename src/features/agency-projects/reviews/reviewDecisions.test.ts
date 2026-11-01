import { describe, expect, it } from "vitest";
import {
  applyReviewCommand,
  currentReviewApprovals,
  parseReviewAction,
  parseReviewCommand,
  type ReviewSnapshot,
} from "./reviewDecisions";

// Root observed initial, epoch and chronology reds. Selected green is still pending.
const scope = {
  projectId: "cdefabcd-3456-4cde-abcd-345678901abc",
  deliverableId: "defabcde-4567-4def-bcde-456789012abc",
  expectedRevision: 4,
};
const nativeRecorder = {
  recordedByUserId: "abcdefab-1234-4abc-8def-1234567890ab",
  recordedAt: "2026-11-01T06:00:00Z",
};
const clientContactId = "bcdefabc-2345-4bcd-9efa-234567890abc";
const version = "https://example.invalid/Review/Model%2Fv1?variant=A%2Fb#Teil-1";
const newerVersion = "https://example.invalid/Review/Model%2Fv2?variant=A%2Fb#Teil-1";

function snapshot(): ReviewSnapshot {
  return {
    projectId: scope.projectId, deliverableId: scope.deliverableId,
    revision: 4, reviewEpoch: 1, reviewOpenedAt: "2026-11-01T05:00:00Z", lastRecordedAt: "2026-11-01T05:00:00Z",
    currentVersionReference: version, decisions: [],
  };
}

function internalReview() {
  return {
    ...scope, ...nativeRecorder,
    action: "record-internal-review" as const,
    outcome: "approved" as const,
    reviewedVersionReference: version,
    method: "internal-review" as const,
    evidenceReference: "review-note/2026-11-01",
    occurredAt: "2026-11-01T05:50:00Z",
  };
}

function recordedClientApproval() {
  return {
    ...scope, ...nativeRecorder,
    action: "record-client-approval" as const,
    outcome: "approved" as const,
    reviewedVersionReference: version,
    clientContactId,
    method: "email" as const,
    evidenceReference: "client-note/2026-11-01",
    occurredAt: "2026-11-01T09:10:00+03:30",
  };
}

function changeVersion(expectedRevision = 4) {
  return {
    ...scope, ...nativeRecorder, expectedRevision,
    action: "change-version" as const,
    versionReference: newerVersion,
    reason: "نسخه جدید / Neue Fassung",
  };
}

function reopenReview(expectedRevision = 4) {
  return {
    ...scope, ...nativeRecorder, expectedRevision,
    action: "reopen-review" as const,
    reason: "بررسی دوباره / Erneute Prüfung",
  };
}

describe("proposed version-specific review decision boundary", () => {
  it("keeps the native recorder and server recording time out of every browser action", () => {
    for (const command of [internalReview(), recordedClientApproval(), changeVersion(), reopenReview()]) {
      const { recordedByUserId, recordedAt, ...action } = command;
      expect(parseReviewAction(action)).toEqual({ ok: true, value: action });
      expect(parseReviewAction({ ...action, recordedByUserId }))
        .toEqual({ ok: false, error: "invalid_review_action" });
      expect(parseReviewAction({ ...action, recordedAt }))
        .toEqual({ ok: false, error: "invalid_review_action" });
      expect(parseReviewAction({ ...action, reviewOpenedAt: "2026-11-01T05:00:00Z" }))
        .toEqual({ ok: false, error: "invalid_review_action" });
      expect(parseReviewAction({ ...action, lastRecordedAt: "2026-11-01T05:00:00Z" }))
        .toEqual({ ok: false, error: "invalid_review_action" });
    }
  });

  it.each(["recordedByUserId", "recordedAt"])("requires server-assembled %s provenance", (field) => {
    const command = { ...recordedClientApproval() };
    Reflect.deleteProperty(command, field);
    expect(parseReviewCommand(command)).toEqual({ ok: false, error: "invalid_review_command" });
  });

  it("canonicalizes native/contact UUIDs while preserving exact version, evidence and occurrence provenance", () => {
    const command = recordedClientApproval();
    expect(parseReviewCommand({
      ...command,
      recordedByUserId: command.recordedByUserId.toUpperCase(),
      clientContactId: command.clientContactId.toUpperCase(),
    })).toEqual({ ok: true, value: command });
    expect(parseReviewCommand({ ...command, lastRecordedAt: "2026-11-01T05:00:00Z" }))
      .toEqual({ ok: false, error: "invalid_review_command" });
  });

  it("rejects external-authentication/signature claims and unqualified method shortcuts", () => {
    const command = recordedClientApproval();
    for (const patch of [
      { authenticatedClient: true }, { signature: "claimed" },
      { method: "provider-verified" }, { clientContactId: "client@example.invalid" },
    ]) expect(parseReviewCommand({ ...command, ...patch }))
      .toEqual({ ok: false, error: "invalid_review_command" });
  });

  it.each(["2026-11-01T09:10:00", "2026-02-30T09:10:00Z", "yesterday", null])(
    "requires a real occurrence instant with an explicit offset: %s", (occurredAt) => {
      expect(parseReviewCommand({ ...recordedClientApproval(), occurredAt }))
        .toEqual({ ok: false, error: "invalid_review_command" });
    },
  );

  it("does not invent an occurrence time or accept one after server recording time", () => {
    const command = { ...recordedClientApproval() };
    Reflect.deleteProperty(command, "occurredAt");
    expect(parseReviewCommand(command)).toEqual({ ok: false, error: "invalid_review_command" });
    expect(parseReviewCommand({ ...recordedClientApproval(), occurredAt: "2026-11-01T06:00:01Z" }))
      .toEqual({ ok: false, error: "invalid_review_command" });
  });

  it("rejects an occurrence one nanosecond after recording without millisecond truncation", () => {
    for (const occurredAt of ["2026-11-01T06:00:00.000000001Z", "2026-11-01T09:30:00.000000001+03:30"]) {
      expect(parseReviewCommand({ ...recordedClientApproval(), occurredAt }))
        .toEqual({ ok: false, error: "invalid_review_command" });
    }
  });

  it("preserves supported nanosecond instants and their original offset strings", () => {
    const command = {
      ...recordedClientApproval(), occurredAt: "2026-11-01T09:30:00.000000001+03:30",
      recordedAt: "2026-11-01T06:00:00.000000002Z",
    };
    expect(parseReviewCommand(command)).toEqual({ ok: true, value: command });
    const equalInstants = { ...command, recordedAt: "2026-11-01T06:00:00.000000001Z" };
    expect(parseReviewCommand(equalInstants)).toEqual({ ok: true, value: equalInstants });
  });

  it("rejects fractional precision beyond nanoseconds instead of silently rounding it", () => {
    expect(parseReviewCommand({ ...recordedClientApproval(), occurredAt: "2026-11-01T05:50:00.0000000001Z" }))
      .toEqual({ ok: false, error: "invalid_review_command" });
    expect(parseReviewCommand({ ...recordedClientApproval(), recordedAt: "2026-11-01T06:00:00.0000000001Z" }))
      .toEqual({ ok: false, error: "invalid_review_command" });
  });

  it.each(["2026-11-01T06:00:00", "2026-02-30T06:00:00Z", "not-a-time", null])(
    "rejects malformed server recording time on every command: %s", (recordedAt) => {
      for (const command of [internalReview(), recordedClientApproval(), changeVersion(), reopenReview()]) {
        expect(parseReviewCommand({ ...command, recordedAt }))
          .toEqual({ ok: false, error: "invalid_review_command" });
      }
    },
  );

  it("rejects missing, whitespace-only, unsafe and oversized change/reopen reasons", () => {
    for (const command of [changeVersion(), reopenReview()]) {
      const action = { ...command };
      Reflect.deleteProperty(action, "recordedByUserId");
      Reflect.deleteProperty(action, "recordedAt");
      for (const reason of [undefined, " \t\n", "سبب\u0000", "Grund\u0085", "x".repeat(2001)]) {
        expect(parseReviewAction({ ...action, reason }))
          .toEqual({ ok: false, error: "invalid_review_action" });
        expect(parseReviewCommand({ ...command, reason }))
          .toEqual({ ok: false, error: "invalid_review_command" });
      }
    }
  });

  it.each(["javascript:alert(1)", "<script>v1</script>", " version-1", "version\u00851"])(
    "rejects unsafe version/evidence references without fetching: %s", (reference) => {
      expect(parseReviewCommand({ ...internalReview(), reviewedVersionReference: reference }))
        .toEqual({ ok: false, error: "invalid_review_command" });
      expect(parseReviewCommand({ ...internalReview(), evidenceReference: reference }))
        .toEqual({ ok: false, error: "invalid_review_command" });
    },
  );
});

describe("proposed immutable review history and optimistic revision policy", () => {
  it("records exact internal approval provenance without changing its input", () => {
    const current = Object.freeze({ ...snapshot(), decisions: Object.freeze([]) });
    const result = applyReviewCommand(current, internalReview());
    expect(result).toMatchObject({ ok: true, value: {
      snapshot: { revision: 5, reviewEpoch: 1, lastRecordedAt: nativeRecorder.recordedAt, currentVersionReference: version, decisions: [{
        kind: "internal-review", outcome: "approved", reviewedVersionReference: version,
        recordedByUserId: nativeRecorder.recordedByUserId, method: "internal-review",
        evidenceReference: "review-note/2026-11-01", occurredAt: "2026-11-01T05:50:00Z",
        recordedAt: nativeRecorder.recordedAt, reviewEpoch: 1, recordedAtRevision: 5,
      }] },
      receipt: {
        policyVersion: 1, action: "record-internal-review",
        projectId: scope.projectId, deliverableId: scope.deliverableId,
        previousRevision: 4, revision: 5, previousReviewEpoch: 1, reviewEpoch: 1,
        previousReviewOpenedAt: "2026-11-01T05:00:00Z", reviewOpenedAt: "2026-11-01T05:00:00Z",
        previousRecordedAt: "2026-11-01T05:00:00Z",
        previousVersionReference: version, versionReference: version,
        ...nativeRecorder, reason: null,
      },
    } });
    expect(current).toEqual({ ...snapshot(), decisions: [] });
    if (!result.ok) return;
    expect(currentReviewApprovals(result.value.snapshot))
      .toEqual({ internal: result.value.snapshot.decisions, recordedClient: [] });
  });

  it("keeps staff-recorded client approval separate from internal review and external authentication", () => {
    const result = applyReviewCommand(snapshot(), recordedClientApproval());
    expect(result).toMatchObject({ ok: true, value: { snapshot: { lastRecordedAt: nativeRecorder.recordedAt, decisions: [{
      kind: "staff-recorded-client-approval", outcome: "approved", reviewedVersionReference: version,
      recordedByUserId: nativeRecorder.recordedByUserId, clientContactId, method: "email",
      evidenceReference: "client-note/2026-11-01", occurredAt: "2026-11-01T09:10:00+03:30",
      recordedAt: nativeRecorder.recordedAt, reviewEpoch: 1, recordedAtRevision: 5,
    }] }, receipt: {
      policyVersion: 1, action: "record-client-approval",
      projectId: scope.projectId, deliverableId: scope.deliverableId,
      previousRevision: 4, revision: 5, previousReviewEpoch: 1, reviewEpoch: 1,
      previousReviewOpenedAt: "2026-11-01T05:00:00Z", reviewOpenedAt: "2026-11-01T05:00:00Z",
      previousRecordedAt: "2026-11-01T05:00:00Z",
      previousVersionReference: version, versionReference: version,
      ...nativeRecorder, reason: null,
    } } });
    if (!result.ok) return;
    expect(currentReviewApprovals(result.value.snapshot))
      .toEqual({ internal: [], recordedClient: result.value.snapshot.decisions });
    expect(result.value.snapshot.decisions[0]).not.toHaveProperty("authenticatedClient");
    expect(result.value.snapshot.decisions[0]).not.toHaveProperty("signature");
  });

  it("retains distinct records for multiple clients instead of inferring universal approval", () => {
    const first = applyReviewCommand(snapshot(), recordedClientApproval());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = applyReviewCommand(first.value.snapshot, {
      ...recordedClientApproval(), expectedRevision: 5,
      clientContactId: "efabcdef-5678-4abc-8def-567890123abc",
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(currentReviewApprovals(second.value.snapshot).recordedClient).toHaveLength(2);
    expect(currentReviewApprovals(second.value.snapshot).internal).toEqual([]);
    expect(currentReviewApprovals(second.value.snapshot)).not.toHaveProperty("allClientsApproved");
  });

  it("gives expected-revision conflicts precedence and fences replay", () => {
    expect(applyReviewCommand(snapshot(), { ...internalReview(), expectedRevision: 3, reviewedVersionReference: newerVersion }))
      .toEqual({ ok: false, error: "revision_conflict" });
    const first = applyReviewCommand(snapshot(), internalReview());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(applyReviewCommand(first.value.snapshot, internalReview()))
      .toEqual({ ok: false, error: "revision_conflict" });
  });

  it.each(["projectId", "deliverableId"] as const)("rejects a decision for a different %s", (field) => {
    expect(applyReviewCommand(snapshot(), { ...internalReview(), [field]: "fabcdefa-6789-4bcd-9efa-678901234abc" }))
      .toEqual({ ok: false, error: "review_target_mismatch" });
  });

  it("compares the external version reference exactly, without URL normalization", () => {
    expect(applyReviewCommand(snapshot(), { ...internalReview(), reviewedVersionReference: version.replace("%2F", "%2f") }))
      .toEqual({ ok: false, error: "review_version_conflict" });
  });

  it("preserves old decisions when a newer version starts a fresh review epoch", () => {
    const approved = applyReviewCommand(snapshot(), internalReview());
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    const historical = structuredClone(approved.value.snapshot.decisions);
    const reason = "نسخه جدید / Neue Fassung\nشرح تغییر / Änderungsgrund";
    const changed = applyReviewCommand(approved.value.snapshot, { ...changeVersion(5), reason });
    expect(changed).toMatchObject({ ok: true, value: {
      snapshot: { revision: 6, reviewEpoch: 2, reviewOpenedAt: nativeRecorder.recordedAt, lastRecordedAt: nativeRecorder.recordedAt, currentVersionReference: newerVersion, decisions: historical },
      receipt: {
        policyVersion: 1, action: "change-version",
        projectId: scope.projectId, deliverableId: scope.deliverableId,
        previousRevision: 5, revision: 6, previousReviewEpoch: 1, reviewEpoch: 2,
        previousReviewOpenedAt: "2026-11-01T05:00:00Z", reviewOpenedAt: nativeRecorder.recordedAt,
        previousRecordedAt: nativeRecorder.recordedAt,
        previousVersionReference: version, versionReference: newerVersion,
        ...nativeRecorder, reason,
      },
    } });
    if (!changed.ok) return;
    expect(currentReviewApprovals(changed.value.snapshot)).toEqual({ internal: [], recordedClient: [] });
    expect(approved.value.snapshot.decisions).toEqual(historical);
  });

  it("reopens the same version without inheriting its earlier recorded client approval", () => {
    const approved = applyReviewCommand(snapshot(), recordedClientApproval());
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    const reason = "بررسی دوباره / Erneute Prüfung\nتأیید قبلی محفوظ می‌ماند";
    const reopened = applyReviewCommand(approved.value.snapshot, { ...reopenReview(5), reason });
    expect(reopened).toMatchObject({ ok: true, value: {
      snapshot: { revision: 6, reviewEpoch: 2, reviewOpenedAt: nativeRecorder.recordedAt, lastRecordedAt: nativeRecorder.recordedAt, currentVersionReference: version, decisions: approved.value.snapshot.decisions },
      receipt: {
        policyVersion: 1, action: "reopen-review",
        projectId: scope.projectId, deliverableId: scope.deliverableId,
        previousRevision: 5, revision: 6, previousReviewEpoch: 1, reviewEpoch: 2,
        previousReviewOpenedAt: "2026-11-01T05:00:00Z", reviewOpenedAt: nativeRecorder.recordedAt,
        previousRecordedAt: nativeRecorder.recordedAt,
        previousVersionReference: version, versionReference: version,
        ...nativeRecorder, reason,
      },
    } });
    if (!reopened.ok) return;
    expect(currentReviewApprovals(reopened.value.snapshot)).toEqual({ internal: [], recordedClient: [] });
  });

  it("requires an explicit reopen rather than relabeling an unchanged version", () => {
    expect(applyReviewCommand(snapshot(), { ...changeVersion(), versionReference: version }))
      .toEqual({ ok: false, error: "version_unchanged" });
  });

  it("makes approve/change ordering deterministic while leaving actual DB races unqualified", () => {
    const approvalFirst = applyReviewCommand(snapshot(), internalReview());
    const versionFirst = applyReviewCommand(snapshot(), changeVersion());
    expect(approvalFirst.ok).toBe(true);
    expect(versionFirst.ok).toBe(true);
    if (!approvalFirst.ok || !versionFirst.ok) return;
    expect(applyReviewCommand(approvalFirst.value.snapshot, changeVersion()))
      .toEqual({ ok: false, error: "revision_conflict" });
    expect(applyReviewCommand(versionFirst.value.snapshot, internalReview()))
      .toEqual({ ok: false, error: "revision_conflict" });
  });

  it("rejects revision overflow for every admitted mutation without changing history", () => {
    const approved = applyReviewCommand(snapshot(), internalReview());
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    const current = { ...approved.value.snapshot, revision: Number.MAX_SAFE_INTEGER };
    const before = structuredClone(current);
    for (const command of [internalReview(), recordedClientApproval(), changeVersion(), reopenReview()]) {
      expect(applyReviewCommand(current, { ...command, expectedRevision: Number.MAX_SAFE_INTEGER }))
        .toEqual({ ok: false, error: "revision_exhausted" });
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
      expect(applyReviewCommand(current, { ...command, expectedRevision: current.revision }))
        .toEqual({ ok: false, error: "review_epoch_exhausted" });
    }
    expect(current).toEqual(before);
  });

  it("can still record evidence at the maximum epoch because recording does not advance it", () => {
    expect(applyReviewCommand({ ...snapshot(), reviewEpoch: Number.MAX_SAFE_INTEGER }, internalReview()))
      .toMatchObject({ ok: true, value: {
        snapshot: { revision: 5, reviewEpoch: Number.MAX_SAFE_INTEGER },
        receipt: { previousReviewEpoch: Number.MAX_SAFE_INTEGER, reviewEpoch: Number.MAX_SAFE_INTEGER },
      } });
  });

  it("does not reassign late old client or internal evidence to a reopened or changed epoch", () => {
    for (const epochCommand of [reopenReview(), changeVersion()]) {
      const opened = applyReviewCommand(snapshot(), epochCommand);
      expect(opened.ok).toBe(true);
      if (!opened.ok) return;
      for (const oldEvidence of [recordedClientApproval(), internalReview()]) {
        expect(applyReviewCommand(opened.value.snapshot, {
          ...oldEvidence, expectedRevision: 5,
          reviewedVersionReference: opened.value.snapshot.currentVersionReference,
        })).toEqual({ ok: false, error: "review_occurrence_before_epoch" });
      }
    }
  });

  it("compares the epoch opening at nanosecond precision and admits an occurrence at that exact instant", () => {
    const current = {
      ...snapshot(), reviewOpenedAt: "2026-11-01T06:00:00.000000001Z",
      lastRecordedAt: "2026-11-01T06:00:00.000000001Z",
    };
    const command = {
      ...recordedClientApproval(), recordedAt: "2026-11-01T06:00:00.000000002Z",
      occurredAt: "2026-11-01T09:30:00.000000000+03:30",
    };
    expect(applyReviewCommand(current, command))
      .toEqual({ ok: false, error: "review_occurrence_before_epoch" });
    expect(applyReviewCommand(current, { ...command, occurredAt: "2026-11-01T09:30:00.000000001+03:30" }).ok)
      .toBe(true);
  });

  it("does not resurrect v1 approval after v1 to v2 to v1 or attach the old fact to its new epoch", () => {
    const approved = applyReviewCommand(snapshot(), recordedClientApproval());
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    const changed = applyReviewCommand(approved.value.snapshot, changeVersion(5));
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    const returned = applyReviewCommand(changed.value.snapshot, {
      ...changeVersion(6), versionReference: version, recordedAt: "2026-11-01T06:10:00Z",
    });
    expect(returned.ok).toBe(true);
    if (!returned.ok) return;
    expect(returned.value.snapshot.decisions).toEqual(approved.value.snapshot.decisions);
    expect(currentReviewApprovals(returned.value.snapshot)).toEqual({ internal: [], recordedClient: [] });
    expect(applyReviewCommand(returned.value.snapshot, {
      ...recordedClientApproval(), expectedRevision: 7, recordedAt: "2026-11-01T06:11:00Z",
    })).toEqual({ ok: false, error: "review_occurrence_before_epoch" });
  });

  it("rejects server time after the original opening but before a prior committed approval", () => {
    const approved = applyReviewCommand(snapshot(), internalReview());
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    const current = Object.freeze({ ...approved.value.snapshot, lastRecordedAt: nativeRecorder.recordedAt });
    const before = structuredClone(current);
    const commands = [
      { ...internalReview(), occurredAt: "2026-11-01T05:20:00Z" },
      { ...recordedClientApproval(), occurredAt: "2026-11-01T05:20:00Z" },
      changeVersion(), reopenReview(),
    ];
    for (const command of commands) {
      expect(applyReviewCommand(current, {
        ...command, expectedRevision: 5, recordedAt: "2026-11-01T05:30:00Z",
      })).toEqual({ ok: false, error: "review_time_conflict" });
    }
    expect(current).toEqual(before);
    const equalTime = applyReviewCommand(current, reopenReview(5));
    expect(equalTime).toMatchObject({ ok: true, value: { snapshot: {
      lastRecordedAt: nativeRecorder.recordedAt, reviewOpenedAt: nativeRecorder.recordedAt,
      decisions: before.decisions,
    } } });
    expect(current).toEqual(before);
  });

  it("does not move an opening backwards by a nanosecond on change or reopen", () => {
    const time = "2026-11-01T06:00:00.000000001Z";
    const current = Object.freeze({ ...snapshot(), reviewOpenedAt: time, lastRecordedAt: time });
    const before = structuredClone(current);
    for (const command of [changeVersion(), reopenReview()]) {
      expect(applyReviewCommand(current, { ...command, recordedAt: "2026-11-01T06:00:00.000000000Z" }))
        .toEqual({ ok: false, error: "review_time_conflict" });
    }
    expect(current).toEqual(before);
  });

  it("permits equal server instants with different offsets and retains exact chronology receipt strings", () => {
    const previous = "2026-11-01T06:00:00.000000001Z";
    const recordedAt = "2026-11-01T09:30:00.000000001+03:30";
    const current = { ...snapshot(), reviewOpenedAt: previous, lastRecordedAt: previous };
    expect(applyReviewCommand(current, { ...reopenReview(), recordedAt }))
      .toMatchObject({ ok: true, value: {
        snapshot: { reviewOpenedAt: recordedAt, lastRecordedAt: recordedAt },
        receipt: { previousReviewOpenedAt: previous, reviewOpenedAt: recordedAt, previousRecordedAt: previous, recordedAt },
      } });
  });

  it("keeps revision and target conflicts ahead of a backward server clock", () => {
    const current = { ...snapshot(), lastRecordedAt: nativeRecorder.recordedAt };
    const command = { ...reopenReview(), recordedAt: "2026-11-01T05:30:00Z" };
    expect(applyReviewCommand(current, { ...command, expectedRevision: 3 }))
      .toEqual({ ok: false, error: "revision_conflict" });
    expect(applyReviewCommand(current, { ...command, deliverableId: "fabcdefa-6789-4bcd-9efa-678901234abc" }))
      .toEqual({ ok: false, error: "review_target_mismatch" });
  });
});
