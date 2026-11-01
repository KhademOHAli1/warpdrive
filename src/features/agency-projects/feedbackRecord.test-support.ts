export const ids = {
  projectId: "cdefabcd-3456-4cde-abcd-345678901abc",
  deliverableId: "defabcde-4567-4def-bcde-456789012abc",
  authorUserId: "bcdefabc-2345-4bcd-9efa-234567890abc",
  personId: "fabcdefa-6789-4bcd-9efa-678901234abc",
  recorderId: "abcdefab-1234-4abc-8def-1234567890ab",
  feedbackId: "aabcdefa-6789-4bcd-9efa-678901234abc",
};

export function declaration() {
  return {
    projectId: ids.projectId,
    deliverableId: ids.deliverableId,
    workVersionReference: "https://work.example.invalid/مدل%2Fv1?variant=A%2Fb#Teil-1",
    author: { kind: "internal-user" as const, userId: ids.authorUserId },
    source: {
      channel: { kind: "email" as const },
      evidenceReference: "https://source.example.invalid/Feedback/A%2Fb?thread=1#Nachricht",
    },
    text: "  رنگ\u200cها روشن بمانند.\nFarben bitte hell lassen.\t  ",
  };
}

export function command() {
  return {
    feedbackId: ids.feedbackId,
    provenance: "staff-recorded" as const,
    declaration: declaration(),
    recordedByUserId: ids.recorderId,
    recordedAt: "2026-11-01T09:30:00.000000001+03:30",
  };
}

export function invalidAuthors() {
  return [
    undefined,
    { kind: "internal-user", userId: "same-name" },
    { kind: "external-contact", personId: "shared@example.invalid" },
    { kind: "external-contact", userId: ids.authorUserId },
    { kind: "internal-user", userId: ids.authorUserId, personId: ids.personId },
    { kind: "authenticated-client", personId: ids.personId },
    { kind: "external-contact", personId: ids.personId, name: "Same name" },
  ];
}

export function invalidSources() {
  return [
    undefined,
    {},
    { channel: { kind: "provider-delivered" } },
    { channel: { kind: "other", label: "\u200c" } },
    { channel: { kind: "other", label: "x".repeat(81) } },
    { channel: { kind: "email" }, authenticated: true },
  ];
}

export function nestedExtraDeclarations() {
  const value = declaration();
  return [
    { boundary: "author", value: { ...value, author: { ...value.author, unexpected: true } } },
    { boundary: "source", value: { ...value, source: { ...value.source, unexpected: true } } },
    {
      boundary: "channel",
      value: { ...value, source: { ...value.source, channel: { kind: "email", unexpected: true } } },
    },
    { boundary: "declaration", value: { ...value, unexpected: true } },
  ];
}

export function browserShortcuts() {
  return [
    { feedbackId: ids.feedbackId },
    { recordedByUserId: ids.recorderId },
    { recordedAt: command().recordedAt },
    { provenance: "staff-recorded" },
    { authenticatedClient: true },
    { signature: "claim" },
    { approved: true },
    { reviewEpoch: 1 },
    { includedRounds: 2 },
    { charge: true },
    { history: [] },
    { feedback: [] },
    { authorized: true },
  ];
}
