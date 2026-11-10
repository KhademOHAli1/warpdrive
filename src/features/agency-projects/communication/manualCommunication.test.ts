import { describe, expect, it } from "vitest";
import {
  parseManualCommunicationAction,
  parseManualCommunicationCommand,
  parseManualCommunicationContext,
} from "./manualCommunication";
import {
  appliedCorrectionIntent,
  context,
  correctionAction,
  correctionCommand,
  deletedRecordIntent,
  ids,
  recordAction,
  recordCommand,
} from "./manualCommunication.test-support";

describe("proposed manual communication boundaries", () => {
  it("accepts explicit record/correct browser data without native identity or time", () => {
    for (const input of [recordAction(), correctionAction()]) {
      expect(parseManualCommunicationAction(input)).toEqual({ ok: true, value: input });
      for (const extra of [
        { recordedByUserId: ids.actorId },
        { recordedAt: "2026-11-01T06:00:00Z" },
      ]) {
        expect(parseManualCommunicationAction({ ...input, ...extra })).toEqual({
          ok: false,
          error: "invalid_manual_action",
        });
      }
    }
    expect(parseManualCommunicationAction({ ...recordAction(), logId: ids.logId })).toEqual({
      ok: false,
      error: "invalid_manual_action",
    });
  });

  it("requires server native recorder/time and server-created record UUID", () => {
    for (const field of ["recordedByUserId", "recordedAt", "logId"]) {
      const input = recordCommand();
      Reflect.deleteProperty(input, field);
      expect(parseManualCommunicationCommand(input)).toEqual({
        ok: false,
        error: "invalid_manual_command",
      });
    }
    const input = recordCommand();
    expect(
      parseManualCommunicationCommand({
        ...input,
        logId: input.logId.toUpperCase(),
        projectId: input.projectId.toUpperCase(),
        personId: input.personId.toUpperCase(),
        mutationIntentId: input.mutationIntentId.toUpperCase(),
        recordedByUserId: input.recordedByUserId.toUpperCase(),
      }),
    ).toEqual({ ok: true, value: input });
  });

  it("requires canonical target/intent UUIDs and correction preconditions", () => {
    for (const field of ["projectId", "personId", "mutationIntentId", "logId"]) {
      expect(
        parseManualCommunicationCommand({
          ...correctionCommand(),
          [field]: "shared@example.invalid",
        }),
      ).toEqual({ ok: false, error: "invalid_manual_command" });
    }
    for (const expectedRevision of [undefined, -1, 1.5, "1"]) {
      expect(parseManualCommunicationCommand({ ...correctionCommand(), expectedRevision })).toEqual(
        { ok: false, error: "invalid_manual_command" },
      );
    }
  });

  it("cannot turn a draft, copy or unqualified provider/client claim into a manual record", () => {
    for (const action of ["draft", "copy", "send", "provider-delivered"]) {
      expect(parseManualCommunicationAction({ ...recordAction(), action })).toEqual({
        ok: false,
        error: "invalid_manual_action",
      });
    }
    for (const extra of [
      { authenticatedClient: true },
      { delivered: true },
      { providerMessageId: "claim" },
      { recipient: "person@example.invalid" },
      { grantAccess: true },
    ]) {
      expect(parseManualCommunicationCommand({ ...recordCommand(), ...extra })).toEqual({
        ok: false,
        error: "invalid_manual_command",
      });
    }
  });

  it("preserves declared protected plain note/evidence and explicit other-channel label", () => {
    const input = {
      ...recordCommand(),
      declaration: {
        ...recordCommand().declaration,
        channel: { kind: "other", label: "گفت‌وگو / Austausch" },
        note: "  گزارش <داخلی>\nStaff record <plain text>  ",
      },
    };
    expect(parseManualCommunicationCommand(input)).toEqual({ ok: true, value: input });
    const withoutEvidence = recordCommand();
    Reflect.deleteProperty(withoutEvidence.declaration, "evidenceReference");
    expect(parseManualCommunicationCommand(withoutEvidence)).toEqual({
      ok: true,
      value: withoutEvidence,
    });
  });

  it("rejects missing/implicit channel, blank or oversized protected note/reason and unsafe evidence", () => {
    const command = recordCommand();
    for (const channel of [
      undefined,
      "email",
      { kind: "automatic" },
      { kind: "email", mailboxId: ids.personId },
      { kind: "other", label: "\u200c" },
    ]) {
      expect(
        parseManualCommunicationCommand({
          ...command,
          declaration: { ...command.declaration, channel },
        }),
      ).toEqual({ ok: false, error: "invalid_manual_command" });
    }
    for (const note of [undefined, " ", "\u200c", "\u2066\u2069", "x".repeat(2001), "متن\u0085"]) {
      expect(
        parseManualCommunicationCommand({
          ...command,
          declaration: { ...command.declaration, note },
        }),
      ).toEqual({ ok: false, error: "invalid_manual_command" });
    }
    for (const reason of [undefined, " \n", "\u200c", "x".repeat(1001), "Grund\u0000"]) {
      expect(parseManualCommunicationCommand({ ...correctionCommand(), reason })).toEqual({
        ok: false,
        error: "invalid_manual_command",
      });
    }
    for (const evidenceReference of [
      null,
      "",
      "javascript:alert(1)",
      "https://user:pass@example.invalid/ref",
      "ref\u0085x",
      "r".repeat(2049),
    ]) {
      expect(
        parseManualCommunicationCommand({
          ...command,
          declaration: { ...command.declaration, evidenceReference },
        }),
      ).toEqual({ ok: false, error: "invalid_manual_command" });
    }
  });

  it("uses exact offset-qualified instants and rejects future sub-millisecond occurrences", () => {
    const command = recordCommand();
    for (const occurredAt of [
      undefined,
      "2026-11-01T05:40:00",
      "2026-02-30T05:40:00Z",
      "2026-11-01T06:00:00.000000001Z",
      "2026-11-01T05:40:00.0000000001Z",
    ]) {
      expect(
        parseManualCommunicationCommand({
          ...command,
          declaration: { ...command.declaration, occurredAt },
        }),
      ).toEqual({ ok: false, error: "invalid_manual_command" });
    }
    const equal = {
      ...command,
      declaration: { ...command.declaration, occurredAt: "2026-11-01T09:30:00.000000001+03:30" },
      recordedAt: "2026-11-01T06:00:00.000000001Z",
    };
    expect(parseManualCommunicationCommand(equal)).toEqual({ ok: true, value: equal });
    for (const recordedAt of [
      "not-a-time",
      "2026-11-01T06:00:00",
      "2026-11-01T06:00:00.0000000001Z",
    ]) {
      expect(parseManualCommunicationCommand({ ...command, recordedAt })).toEqual({
        ok: false,
        error: "invalid_manual_command",
      });
    }
  });

  it("allows a late-entered historical occurrence without importing the review-epoch rule", () => {
    const input = {
      ...recordCommand(),
      declaration: { ...recordCommand().declaration, occurredAt: "2020-01-02T09:00:00+03:30" },
    };
    expect(parseManualCommunicationCommand(input)).toEqual({ ok: true, value: input });
  });
});

describe("proposed bounded private context ingress", () => {
  it("validates one current head and at most one scoped intent without loading growing history", () => {
    const input = context();
    expect(parseManualCommunicationContext(input)).toEqual({ ok: true, value: input });
    const deleted = { current: null, priorIntent: deletedRecordIntent() };
    expect(parseManualCommunicationContext(deleted)).toEqual({ ok: true, value: deleted });
    const correctedRecipient = {
      ...input,
      current: { ...input.current, revision: 3, personId: ids.correctedPersonId },
    };
    expect(parseManualCommunicationContext(correctedRecipient)).toEqual({
      ok: true,
      value: correctedRecipient,
    });
  });

  it("rejects head/receipt scope, revision and exact chronology incoherence", () => {
    const input = { ...context(), priorIntent: appliedCorrectionIntent() };
    for (const invalid of [
      { ...input, current: { ...input.current, revision: 1 } },
      { ...input, current: { ...input.current, lastRecordedAt: "2026-11-01T06:09:59.999999999Z" } },
      { ...input, current: { ...input.current, lastRecordedAt: "2026-11-01T06:11:00Z" } },
      { ...input, current: { ...input.current, logId: ids.otherLogId } },
      { ...input, current: { ...input.current, personId: ids.correctedPersonId } },
      {
        ...input,
        priorIntent: {
          ...input.priorIntent,
          receipt: { ...input.priorIntent.receipt, previousRevision: 0 },
        },
      },
      { ...input, current: { ...input.current, declaration: recordCommand().declaration } },
    ])
      expect(parseManualCommunicationContext(invalid)).toEqual({
        ok: false,
        error: "invalid_manual_context",
      });
  });

  it("rejects receipt/request key mismatch and a growing history or authority flag", () => {
    const input = context();
    for (const invalid of [
      {
        ...input,
        priorIntent: {
          ...input.priorIntent,
          request: { ...input.priorIntent.request, mutationIntentId: ids.laterIntent },
        },
      },
      { ...input, priorIntent: [input.priorIntent] },
      { ...input, history: [input.priorIntent] },
      { ...input, authorized: true },
    ])
      expect(parseManualCommunicationContext(invalid)).toEqual({
        ok: false,
        error: "invalid_manual_context",
      });
  });
});
