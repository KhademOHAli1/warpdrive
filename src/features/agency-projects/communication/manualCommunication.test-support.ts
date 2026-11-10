// Synthetic test data only. These UUIDs do not identify users, contacts or external accounts.
export const ids = {
  projectId: "cdefabcd-3456-4cde-abcd-345678901abc",
  personId: "bcdefabc-2345-4bcd-9efa-234567890abc",
  correctedPersonId: "efabcdef-5678-4abc-8def-567890123abc",
  logId: "defabcde-4567-4def-bcde-456789012abc",
  otherLogId: "fabcdefa-6789-4bcd-9efa-678901234abc",
  actorId: "abcdefab-1234-4abc-8def-1234567890ab",
  otherActorId: "fedcba98-8765-4def-bcde-876543210abc",
  recordIntent: "faabcdef-6789-4bcd-9efa-678901234abc",
  correctionIntent: "abcdef12-7890-4cde-abcd-789012345abc",
  laterIntent: "fedcba98-9876-4def-bcde-987654321abc",
};

export function declaration() {
  return {
    channel: { kind: "email" as const },
    occurredAt: "2026-11-01T05:40:00.000000001Z",
    note: "گزارش پیشرفت ثبت شد / Fortschritt mitgeteilt",
    evidenceReference: "https://notes.example.invalid/Update/A%2Fb#Teil-1",
  };
}

export function recordAction() {
  return {
    action: "record" as const,
    mutationIntentId: ids.recordIntent,
    projectId: ids.projectId,
    personId: ids.personId,
    declaration: declaration(),
  };
}

export function recordCommand() {
  return {
    ...recordAction(),
    logId: ids.logId,
    recordedByUserId: ids.actorId,
    recordedAt: "2026-11-01T06:00:00Z",
  };
}

export function correctionAction() {
  return {
    action: "correct" as const,
    mutationIntentId: ids.correctionIntent,
    projectId: ids.projectId,
    personId: ids.personId,
    logId: ids.logId,
    expectedRevision: 1,
    declaration: {
      ...declaration(),
      occurredAt: "2026-11-01T05:45:00+00:00",
      note: "اصلاح زمان / Zeitangabe korrigiert",
    },
    reason: "  اصلاح یادداشت کارکنان / Aufzeichnung korrigiert  ",
  };
}

export function correctionCommand() {
  return {
    ...correctionAction(),
    recordedByUserId: ids.actorId,
    recordedAt: "2026-11-01T06:10:00Z",
  };
}

export function laterCorrection() {
  return {
    ...correctionCommand(),
    mutationIntentId: ids.laterIntent,
    expectedRevision: 2,
    recordedAt: "2026-11-01T06:20:00Z",
    declaration: { ...declaration(), note: "یادداشت کامل‌تر / Ergänzte Aufzeichnung" },
    reason: "تکمیل یادداشت / Ergänzung",
  };
}

export function recordReceipt() {
  const command = recordCommand();
  return {
    policyVersion: 1 as const,
    provenance: "staff-recorded" as const,
    action: command.action,
    mutationIntentId: command.mutationIntentId,
    projectId: command.projectId,
    personId: command.personId,
    logId: command.logId,
    recordedByUserId: command.recordedByUserId,
    recordedAt: command.recordedAt,
    revision: 1,
    previousRevision: 0,
    previousPersonId: null,
    reason: null,
  };
}

export function correctionReceipt() {
  const command = correctionCommand();
  return {
    policyVersion: 1 as const,
    provenance: "staff-recorded" as const,
    action: command.action,
    mutationIntentId: command.mutationIntentId,
    projectId: command.projectId,
    personId: command.personId,
    logId: command.logId,
    recordedByUserId: command.recordedByUserId,
    recordedAt: command.recordedAt,
    revision: 2,
    previousRevision: 1,
    previousPersonId: ids.personId,
    reason: command.reason,
  };
}

export function currentHead() {
  return {
    projectId: ids.projectId,
    personId: ids.personId,
    logId: ids.logId,
    provenance: "staff-recorded" as const,
    revision: 2,
    lastRecordedAt: correctionCommand().recordedAt,
    declaration: correctionCommand().declaration,
  };
}

export function appliedRecordIntent() {
  return { state: "applied" as const, request: recordAction(), receipt: recordReceipt() };
}

export function appliedCorrectionIntent() {
  return { state: "applied" as const, request: correctionAction(), receipt: correctionReceipt() };
}

export function deletedRecordIntent() {
  return {
    state: "deleted" as const,
    key: {
      recordedByUserId: ids.actorId,
      action: "record" as const,
      mutationIntentId: ids.recordIntent,
    },
  };
}

export function context() {
  return { current: currentHead(), priorIntent: appliedRecordIntent() };
}
