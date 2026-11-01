export const draftId = (value: number) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
export const draftDigest = (value: string) => value.repeat(64);

export function scopeDraftFixture() {
  const binding = {
    caseId: draftId(1),
    subject: { kind: "contact", subjectRef: draftId(2), referenceId: draftId(3) },
    identityScopeVersion: 4,
    disclosureScopeRef: draftId(4),
    disclosureRevision: 1,
    recipientVersion: 1,
    verificationVersion: 2,
    policyVersion: 1,
    policyGeneration: 1,
    registryVersion: 1,
    registryFingerprint: draftDigest("a"),
    catalogFingerprint: draftDigest("b"),
    sourceFingerprint: draftDigest("c"),
    mode: "access",
  };
  const provenance = [
    {
      relation: "verified_subject",
      confidence: "exact",
      review: "reviewed",
      evidenceRef: draftId(9),
      sourceFingerprint: draftDigest("d"),
    },
  ];
  const source = {
    recordRef: draftId(5),
    locator: { kind: "uuid", store: "persons", id: draftId(3) },
    sourceFingerprint: draftDigest("e"),
    provenance,
  };
  const context = {
    binding,
    categories: [
      {
        store: "persons",
        adapterVersion: 1,
        capability: "supported",
        enumeration: "complete",
        records: [{ ...source, fields: ["name", "primaryEmail"] }],
      },
      {
        store: "users",
        adapterVersion: 2,
        capability: "supported",
        enumeration: "complete",
        records: [],
      },
    ],
  };
  const common = {
    review: "reviewed",
    decisionRef: draftId(10),
    portability: "eligible",
    provenanceRef: draftId(9),
  };
  const input = {
    binding: structuredClone(binding),
    categories: [
      {
        store: "persons",
        adapterVersion: 1,
        decision: { disposition: "include", review: "reviewed", decisionRef: draftId(11) },
        records: [
          {
            ...structuredClone(source),
            decisions: [
              { ...common, field: "name", action: "include", thirdParty: "none" },
              {
                ...common,
                field: "primaryEmail",
                action: "redact",
                thirdParty: "redacted",
                reason: "third_party_rights",
                replacement: {
                  replacementRef: draftId(12),
                  valueKind: "text",
                  sha256: draftDigest("f"),
                },
              },
            ],
          },
        ],
      },
      {
        store: "users",
        adapterVersion: 2,
        decision: {
          disposition: "exclude",
          review: "reviewed",
          decisionRef: draftId(13),
          reason: "not_subject_data",
        },
        records: [],
      },
    ],
  };
  return { context, input };
}
