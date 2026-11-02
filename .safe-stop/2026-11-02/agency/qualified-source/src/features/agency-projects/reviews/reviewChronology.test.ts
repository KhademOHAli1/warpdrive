import { describe, expect, it } from "vitest";
import { applyReviewCommand } from "./reviewDecisions";
import {
  changeVersion,
  internalReview,
  nativeRecorder,
  recordedClientApproval,
  reopenReview,
  snapshot,
} from "./reviewDecisions.test-support";

describe("review recording chronology", () => {
  it("rejects server time after the original opening but before a prior committed approval", () => {
    const approved = applyReviewCommand(snapshot(), internalReview());
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    const current = Object.freeze({
      ...approved.value.snapshot,
      lastRecordedAt: nativeRecorder.recordedAt,
    });
    const before = structuredClone(current);
    const commands = [
      { ...internalReview(), occurredAt: "2026-11-01T05:20:00Z" },
      { ...recordedClientApproval(), occurredAt: "2026-11-01T05:20:00Z" },
      changeVersion(),
      reopenReview(),
    ];
    for (const command of commands) {
      expect(
        applyReviewCommand(current, {
          ...command,
          expectedRevision: 5,
          recordedAt: "2026-11-01T05:30:00Z",
        }),
      ).toEqual({ ok: false, error: "review_time_conflict" });
    }
    expect(current).toEqual(before);
    const equalTime = applyReviewCommand(current, reopenReview(5));
    expect(equalTime).toMatchObject({
      ok: true,
      value: {
        snapshot: {
          lastRecordedAt: nativeRecorder.recordedAt,
          reviewOpenedAt: nativeRecorder.recordedAt,
          decisions: before.decisions,
        },
      },
    });
    expect(current).toEqual(before);
  });

  it("does not move an opening backwards by a nanosecond on change or reopen", () => {
    const time = "2026-11-01T06:00:00.000000001Z";
    const current = Object.freeze({ ...snapshot(), reviewOpenedAt: time, lastRecordedAt: time });
    const before = structuredClone(current);
    for (const command of [changeVersion(), reopenReview()]) {
      expect(
        applyReviewCommand(current, { ...command, recordedAt: "2026-11-01T06:00:00.000000000Z" }),
      ).toEqual({ ok: false, error: "review_time_conflict" });
    }
    expect(current).toEqual(before);
  });

  it("permits equal server instants with different offsets and retains exact chronology receipt strings", () => {
    const previous = "2026-11-01T06:00:00.000000001Z";
    const recordedAt = "2026-11-01T09:30:00.000000001+03:30";
    const current = { ...snapshot(), reviewOpenedAt: previous, lastRecordedAt: previous };
    expect(applyReviewCommand(current, { ...reopenReview(), recordedAt })).toMatchObject({
      ok: true,
      value: {
        snapshot: { reviewOpenedAt: recordedAt, lastRecordedAt: recordedAt },
        receipt: {
          previousReviewOpenedAt: previous,
          reviewOpenedAt: recordedAt,
          previousRecordedAt: previous,
          recordedAt,
        },
      },
    });
  });

  it("keeps revision and target conflicts ahead of a backward server clock", () => {
    const current = { ...snapshot(), lastRecordedAt: nativeRecorder.recordedAt };
    const command = { ...reopenReview(), recordedAt: "2026-11-01T05:30:00Z" };
    expect(applyReviewCommand(current, { ...command, expectedRevision: 3 })).toEqual({
      ok: false,
      error: "revision_conflict",
    });
    expect(
      applyReviewCommand(current, {
        ...command,
        deliverableId: "fabcdefa-6789-4bcd-9efa-678901234abc",
      }),
    ).toEqual({ ok: false, error: "review_target_mismatch" });
  });
});
