import { describe, expect, it } from "vitest";
import { applyManualCommunicationCommand } from "./manualCommunication";
import {
  appliedCorrectionIntent,
  appliedRecordIntent,
  context,
  correctionCommand,
  currentHead,
  deletedRecordIntent,
  ids,
  laterCorrection,
  recordCommand,
  recordReceipt,
} from "./manualCommunication.test-support";

describe("proposed manual record/correct/replay policy", () => {
  it("returns a staff-recorded head, private receipt and append descriptor for a fresh record", () => {
    const command = recordCommand();
    const result = applyManualCommunicationCommand({ current: null, priorIntent: null }, command);
    expect(result).toEqual({
      ok: true,
      value: {
        replayed: false,
        receipt: recordReceipt(),
        snapshot: {
          projectId: ids.projectId,
          personId: ids.personId,
          logId: ids.logId,
          provenance: "staff-recorded",
          revision: 1,
          lastRecordedAt: command.recordedAt,
          declaration: command.declaration,
        },
        appendEvent: {
          receipt: recordReceipt(),
          before: null,
          after: { personId: ids.personId, declaration: command.declaration },
        },
      },
    });
  });

  it("corrects a bounded head with an original-facts/reason delta instead of overwriting history", () => {
    const input = Object.freeze({ current: Object.freeze(currentHead()), priorIntent: null });
    const before = structuredClone(input);
    const command = laterCorrection();
    const result = applyManualCommunicationCommand(input, command);
    expect(result).toMatchObject({
      ok: true,
      value: {
        replayed: false,
        snapshot: {
          revision: 3,
          declaration: command.declaration,
          lastRecordedAt: command.recordedAt,
        },
        receipt: {
          action: "correct",
          provenance: "staff-recorded",
          previousRevision: 2,
          revision: 3,
          reason: command.reason,
        },
        appendEvent: {
          before: { personId: input.current.personId, declaration: input.current.declaration },
          after: { personId: command.personId, declaration: command.declaration },
        },
      },
    });
    expect(input).toEqual(before);
  });

  it("replays an old record intent after correction without reverting content or using retry metadata", () => {
    const input = context();
    const before = structuredClone(input);
    expect(
      applyManualCommunicationCommand(input, {
        ...recordCommand(),
        logId: ids.otherLogId,
        recordedAt: "2026-11-01T06:05:00Z",
      }),
    ).toEqual({
      ok: true,
      value: {
        replayed: true,
        snapshot: input.current,
        receipt: input.priorIntent.receipt,
        appendEvent: null,
      },
    });
    expect(input).toEqual(before);
  });

  it("replays an older correction against the current head with its original receipt and no new append", () => {
    const initial = applyManualCommunicationCommand(
      { current: currentHead(), priorIntent: null },
      laterCorrection(),
    );
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;
    const priorIntent = appliedCorrectionIntent();
    expect(
      applyManualCommunicationCommand(
        { current: initial.value.snapshot, priorIntent },
        {
          ...correctionCommand(),
          recordedAt: "2026-11-01T06:15:00Z",
        },
      ),
    ).toEqual({
      ok: true,
      value: {
        replayed: true,
        snapshot: initial.value.snapshot,
        receipt: priorIntent.receipt,
        appendEvent: null,
      },
    });
  });

  it("conflicts on changed semantic declaration using the same actor/action/intent", () => {
    const command = recordCommand();
    for (const declaration of [
      { ...command.declaration, note: "متن دیگر / Anderer Text" },
      { ...command.declaration, channel: { kind: "phone" as const } },
      { ...command.declaration, occurredAt: "2026-11-01T09:10:00.000000001+03:30" },
      { ...command.declaration, evidenceReference: "another-protected-reference" },
    ])
      expect(applyManualCommunicationCommand(context(), { ...command, declaration })).toEqual({
        ok: false,
        error: "manual_intent_conflict",
      });
    const input = { current: currentHead(), priorIntent: appliedCorrectionIntent() };
    expect(
      applyManualCommunicationCommand(input, {
        ...correctionCommand(),
        reason: "Different reason",
      }),
    ).toEqual({ ok: false, error: "manual_intent_conflict" });
    expect(
      applyManualCommunicationCommand(input, { ...correctionCommand(), expectedRevision: 2 }),
    ).toEqual({ ok: false, error: "manual_intent_conflict" });
    expect(
      applyManualCommunicationCommand(input, {
        ...correctionCommand(),
        personId: ids.correctedPersonId,
      }),
    ).toEqual({ ok: false, error: "manual_intent_conflict" });
  });

  it("never discloses a different actor/action/intent receipt supplied by a mismatched lookup", () => {
    for (const command of [
      { ...recordCommand(), recordedByUserId: ids.otherActorId },
      { ...recordCommand(), mutationIntentId: ids.laterIntent },
      { ...laterCorrection(), mutationIntentId: ids.recordIntent },
    ])
      expect(applyManualCommunicationCommand(context(), command)).toEqual({
        ok: false,
        error: "manual_intent_unavailable",
      });
    const distinctAction = { ...laterCorrection(), mutationIntentId: ids.recordIntent };
    expect(
      applyManualCommunicationCommand(
        { current: currentHead(), priorIntent: null },
        distinctAction,
      ),
    ).toMatchObject({
      ok: true,
      value: { replayed: false, receipt: { action: "correct", revision: 3 } },
    });
  });

  it("does not recreate a missing/deleted head when a scoped applied or deleted intent is known", () => {
    for (const priorIntent of [appliedRecordIntent(), deletedRecordIntent()]) {
      expect(
        applyManualCommunicationCommand({ current: null, priorIntent }, recordCommand()),
      ).toEqual({ ok: false, error: "manual_intent_unavailable" });
    }
    expect(
      applyManualCommunicationCommand(
        { current: currentHead(), priorIntent: deletedRecordIntent() },
        recordCommand(),
      ),
    ).toEqual({ ok: false, error: "manual_intent_unavailable" });
  });

  it("checks fresh-write target/revision without pretending pure checks are database CAS", () => {
    const input = { current: currentHead(), priorIntent: null };
    expect(applyManualCommunicationCommand(input, recordCommand())).toEqual({
      ok: false,
      error: "manual_log_exists",
    });
    expect(
      applyManualCommunicationCommand({ current: null, priorIntent: null }, correctionCommand()),
    ).toEqual({ ok: false, error: "manual_log_missing" });
    expect(
      applyManualCommunicationCommand(input, { ...laterCorrection(), expectedRevision: 1 }),
    ).toEqual({ ok: false, error: "manual_revision_conflict" });
    for (const field of ["projectId", "logId"] as const) {
      expect(
        applyManualCommunicationCommand(input, { ...laterCorrection(), [field]: ids.otherLogId }),
      ).toEqual({ ok: false, error: "manual_target_conflict" });
    }
  });

  it("explicitly corrects a misrecorded recipient while preserving old/new person facts and replay", () => {
    const input = { current: currentHead(), priorIntent: null };
    const before = structuredClone(input);
    const command = {
      ...laterCorrection(),
      personId: ids.correctedPersonId,
      declaration: input.current.declaration,
      reason: "اصلاح مخاطب / Empfänger korrigiert",
    };
    const corrected = applyManualCommunicationCommand(input, command);
    expect(corrected).toMatchObject({
      ok: true,
      value: {
        snapshot: {
          projectId: ids.projectId,
          logId: ids.logId,
          personId: ids.correctedPersonId,
          revision: 3,
        },
        receipt: {
          previousPersonId: ids.personId,
          personId: ids.correctedPersonId,
          reason: command.reason,
        },
        appendEvent: {
          before: { personId: ids.personId, declaration: input.current.declaration },
          after: { personId: ids.correctedPersonId, declaration: input.current.declaration },
        },
      },
    });
    expect(input).toEqual(before);
    if (!corrected.ok) return;
    const priorIntent = appliedRecordIntent();
    expect(
      applyManualCommunicationCommand(
        { current: corrected.value.snapshot, priorIntent },
        recordCommand(),
      ),
    ).toEqual({
      ok: true,
      value: {
        snapshot: corrected.value.snapshot,
        receipt: priorIntent.receipt,
        replayed: true,
        appendEvent: null,
      },
    });
  });

  it("keeps recording chronology exact, allowing equality but no one-nanosecond rewind", () => {
    const input = { current: currentHead(), priorIntent: null };
    const before = structuredClone(input);
    expect(
      applyManualCommunicationCommand(input, {
        ...laterCorrection(),
        recordedAt: "2026-11-01T06:09:59.999999999Z",
      }),
    ).toEqual({ ok: false, error: "manual_time_conflict" });
    const recordedAt = "2026-11-01T09:40:00+03:30";
    expect(
      applyManualCommunicationCommand(input, { ...laterCorrection(), recordedAt }),
    ).toMatchObject({
      ok: true,
      value: { snapshot: { lastRecordedAt: recordedAt }, receipt: { recordedAt } },
    });
    expect(input).toEqual(before);
  });

  it("permits a genuine late-entered historical correction while fencing revision overflow", () => {
    const input = { current: currentHead(), priorIntent: null };
    expect(
      applyManualCommunicationCommand(input, {
        ...laterCorrection(),
        declaration: { ...laterCorrection().declaration, occurredAt: "2020-01-02T09:00:00+03:30" },
      }).ok,
    ).toBe(true);
    const exhausted = {
      current: { ...currentHead(), revision: Number.MAX_SAFE_INTEGER },
      priorIntent: null,
    };
    expect(
      applyManualCommunicationCommand(exhausted, {
        ...laterCorrection(),
        expectedRevision: Number.MAX_SAFE_INTEGER,
      }),
    ).toEqual({ ok: false, error: "manual_revision_exhausted" });
    const replay = { current: exhausted.current, priorIntent: appliedRecordIntent() };
    expect(applyManualCommunicationCommand(replay, recordCommand())).toMatchObject({
      ok: true,
      value: { replayed: true, snapshot: exhausted.current, appendEvent: null },
    });
  });
});
