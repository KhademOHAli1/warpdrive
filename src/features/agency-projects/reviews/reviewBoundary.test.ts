import { describe, expect, it } from "vitest";
import { parseReviewAction, parseReviewCommand } from "./reviewDecisions";
import {
  changeVersion,
  internalReview,
  recordedClientApproval,
  reopenReview,
} from "./reviewDecisions.test-support";

describe("proposed version-specific review decision boundary", () => {
  it("keeps the native recorder and server recording time out of every browser action", () => {
    for (const command of [
      internalReview(),
      recordedClientApproval(),
      changeVersion(),
      reopenReview(),
    ]) {
      const { recordedByUserId, recordedAt, ...action } = command;
      expect(parseReviewAction(action)).toEqual({ ok: true, value: action });
      expect(parseReviewAction({ ...action, recordedByUserId })).toEqual({
        ok: false,
        error: "invalid_review_action",
      });
      expect(parseReviewAction({ ...action, recordedAt })).toEqual({
        ok: false,
        error: "invalid_review_action",
      });
      expect(parseReviewAction({ ...action, reviewOpenedAt: "2026-11-01T05:00:00Z" })).toEqual({
        ok: false,
        error: "invalid_review_action",
      });
      expect(parseReviewAction({ ...action, lastRecordedAt: "2026-11-01T05:00:00Z" })).toEqual({
        ok: false,
        error: "invalid_review_action",
      });
    }
  });

  it.each(["recordedByUserId", "recordedAt"])(
    "requires server-assembled %s provenance",
    (field) => {
      const command = { ...recordedClientApproval() };
      Reflect.deleteProperty(command, field);
      expect(parseReviewCommand(command)).toEqual({ ok: false, error: "invalid_review_command" });
    },
  );

  it("canonicalizes native/contact UUIDs while preserving exact version, evidence and occurrence provenance", () => {
    const command = recordedClientApproval();
    expect(
      parseReviewCommand({
        ...command,
        recordedByUserId: command.recordedByUserId.toUpperCase(),
        clientContactId: command.clientContactId.toUpperCase(),
      }),
    ).toEqual({ ok: true, value: command });
    expect(parseReviewCommand({ ...command, lastRecordedAt: "2026-11-01T05:00:00Z" })).toEqual({
      ok: false,
      error: "invalid_review_command",
    });
  });

  it("rejects external-authentication/signature claims and unqualified method shortcuts", () => {
    const command = recordedClientApproval();
    for (const patch of [
      { authenticatedClient: true },
      { signature: "claimed" },
      { method: "provider-verified" },
      { clientContactId: "client@example.invalid" },
    ])
      expect(parseReviewCommand({ ...command, ...patch })).toEqual({
        ok: false,
        error: "invalid_review_command",
      });
  });

  it.each(["2026-11-01T09:10:00", "2026-02-30T09:10:00Z", "yesterday", null])(
    "requires a real occurrence instant with an explicit offset: %s",
    (occurredAt) => {
      expect(parseReviewCommand({ ...recordedClientApproval(), occurredAt })).toEqual({
        ok: false,
        error: "invalid_review_command",
      });
    },
  );

  it("does not invent an occurrence time or accept one after server recording time", () => {
    const command = { ...recordedClientApproval() };
    Reflect.deleteProperty(command, "occurredAt");
    expect(parseReviewCommand(command)).toEqual({ ok: false, error: "invalid_review_command" });
    expect(
      parseReviewCommand({ ...recordedClientApproval(), occurredAt: "2026-11-01T06:00:01Z" }),
    ).toEqual({ ok: false, error: "invalid_review_command" });
  });

  it("rejects an occurrence one nanosecond after recording without millisecond truncation", () => {
    for (const occurredAt of [
      "2026-11-01T06:00:00.000000001Z",
      "2026-11-01T09:30:00.000000001+03:30",
    ]) {
      expect(parseReviewCommand({ ...recordedClientApproval(), occurredAt })).toEqual({
        ok: false,
        error: "invalid_review_command",
      });
    }
  });

  it("preserves supported nanosecond instants and their original offset strings", () => {
    const command = {
      ...recordedClientApproval(),
      occurredAt: "2026-11-01T09:30:00.000000001+03:30",
      recordedAt: "2026-11-01T06:00:00.000000002Z",
    };
    expect(parseReviewCommand(command)).toEqual({ ok: true, value: command });
    const equalInstants = { ...command, recordedAt: "2026-11-01T06:00:00.000000001Z" };
    expect(parseReviewCommand(equalInstants)).toEqual({ ok: true, value: equalInstants });
  });

  it("rejects fractional precision beyond nanoseconds instead of silently rounding it", () => {
    expect(
      parseReviewCommand({
        ...recordedClientApproval(),
        occurredAt: "2026-11-01T05:50:00.0000000001Z",
      }),
    ).toEqual({ ok: false, error: "invalid_review_command" });
    expect(
      parseReviewCommand({
        ...recordedClientApproval(),
        recordedAt: "2026-11-01T06:00:00.0000000001Z",
      }),
    ).toEqual({ ok: false, error: "invalid_review_command" });
  });

  it.each(["2026-11-01T06:00:00", "2026-02-30T06:00:00Z", "not-a-time", null])(
    "rejects malformed server recording time on every command: %s",
    (recordedAt) => {
      for (const command of [
        internalReview(),
        recordedClientApproval(),
        changeVersion(),
        reopenReview(),
      ]) {
        expect(parseReviewCommand({ ...command, recordedAt })).toEqual({
          ok: false,
          error: "invalid_review_command",
        });
      }
    },
  );

  it("rejects missing, whitespace-only, unsafe and oversized change/reopen reasons", () => {
    for (const command of [changeVersion(), reopenReview()]) {
      const action = { ...command };
      Reflect.deleteProperty(action, "recordedByUserId");
      Reflect.deleteProperty(action, "recordedAt");
      for (const reason of [undefined, " \t\n", "سبب\u0000", "Grund\u0085", "x".repeat(2001)]) {
        expect(parseReviewAction({ ...action, reason })).toEqual({
          ok: false,
          error: "invalid_review_action",
        });
        expect(parseReviewCommand({ ...command, reason })).toEqual({
          ok: false,
          error: "invalid_review_command",
        });
      }
    }
  });

  it.each(["javascript:alert(1)", "<script>v1</script>", " version-1", "version\u00851"])(
    "rejects unsafe version/evidence references without fetching: %s",
    (reference) => {
      expect(
        parseReviewCommand({ ...internalReview(), reviewedVersionReference: reference }),
      ).toEqual({ ok: false, error: "invalid_review_command" });
      expect(parseReviewCommand({ ...internalReview(), evidenceReference: reference })).toEqual({
        ok: false,
        error: "invalid_review_command",
      });
    },
  );
});
