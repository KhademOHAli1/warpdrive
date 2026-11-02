export const projectId = "cdefabcd-3456-4cde-abcd-345678901abc";
export const deliverableId = "defabcde-4567-4def-bcde-456789012abc";
export const recorderId = "abcdefab-1234-4abc-8def-1234567890ab";
export const evidenceReference =
  "https://agreement.example.invalid/Project/مدل%2Fv1?part=A%2Fb#Teil-1";

export function round(roundNumber = 1) {
  return { projectId, deliverableId, roundNumber, expectedAllowanceVersion: 2 };
}

export function recorded() {
  return {
    projectId,
    deliverableId,
    version: 2,
    provenance: "staff-recorded" as const,
    recordedByUserId: recorderId,
    recordedAt: "2026-11-01T09:30:00.000000001+03:30",
  };
}

export function agreed(includedRounds = 2) {
  return {
    ...recorded(),
    kind: "agreed" as const,
    includedRounds,
    agreementSource: "  شرح\u200c خدمات / Leistungsbeschreibung  ",
    evidenceReference,
  };
}

export function unknownAllowance() {
  return { ...recorded(), kind: "unknown" as const };
}
