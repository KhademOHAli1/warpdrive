import { randomUUID } from "node:crypto";
import type { DisclosureContext } from "./disclosureSchemas";

type Decision = DisclosureContext["expectedCategories"][number]["decision"];
type CategoryId = "contacts" | "derived" | "mail" | "security";
export const excludedDecision = (
  reason: Extract<Decision, { disposition: "exclude" }>["reason"],
) => ({
  disposition: "exclude" as const,
  reviewed: true,
  reviewId: randomUUID(),
  reason,
});
export const unsupportedDecision = () => ({
  disposition: "unsupported" as const,
  reviewed: true,
  reviewId: randomUUID(),
  reason: "adapter_unavailable" as const,
  task: "DPL-08",
});
export const includedDecision = (
  portabilityEligible = true,
): Extract<Decision, { disposition: "include" }> => ({
  disposition: "include",
  reviewed: true,
  reviewId: randomUUID(),
  thirdParty: "none",
  portabilityEligible,
  transformations: [],
  email: { original: "not_applicable", exported: "not_applicable" },
});

export function fixture(decisions: Partial<Record<CategoryId, Decision>> = {}) {
  const contactId = randomUUID();
  const derivedId = randomUUID();
  const messageId = randomUUID();
  const binding = {
    caseId: randomUUID(),
    subjectId: randomUUID(),
    scopeId: randomUUID(),
    scopeVersion: 2,
    scopeHash: "a".repeat(64),
    policyVersion: 3,
    policyGeneration: 4,
    recipientVersion: 2,
    verificationVersion: 2,
  };
  // Define server decisions independently; request fixtures are copies that tests can tamper with.
  const context: DisclosureContext = {
    binding,
    mode: "access",
    approvalId: randomUUID(),
    scopeApproved: true,
    subjectVerified: true,
    policy: {
      activated: true,
      disclosureEnabled: true,
      portabilityDecision: "eligible",
      portabilityReviewId: randomUUID(),
    },
    expectedCategories: [
      {
        id: "contacts",
        sourceStore: "table:persons",
        capability: "supported",
        recordIds: [contactId],
        decision: decisions.contacts ?? includedDecision(),
      },
      {
        id: "derived",
        sourceStore: "table:enrichment_runs",
        capability: "supported",
        recordIds: [derivedId],
        decision: decisions.derived ?? includedDecision(false),
      },
      {
        id: "mail",
        sourceStore: "table:email_messages",
        capability: "supported",
        recordIds: [messageId],
        decision: decisions.mail ?? {
          ...includedDecision(),
          email: { original: "unavailable", exported: "reconstructed" },
          transformations: ["reconstructed_mime"],
        },
      },
      {
        id: "security",
        sourceStore: "table:auth_accounts",
        capability: "unsupported",
        recordIds: [randomUUID()],
        decision: decisions.security ?? excludedDecision("security_material"),
      },
    ],
  };
  const file = (
    id: string,
    path: string,
    representation: "json" | "reconstructed_eml" = "json",
  ) => ({ path, sha256: "b".repeat(64), bytes: 123, recordIds: [id], representation });
  const categoryFiles = [
    [file(contactId, `records/${contactId}/مخاطب.json`)],
    [file(derivedId, `records/${derivedId}/Ergänzung.json`)],
    [file(messageId, `email/${messageId}/message.eml`, "reconstructed_eml")],
    [],
  ];
  const input: {
    formatVersion: number;
    binding: typeof binding;
    mode: string;
    locale: string;
    generatedAt: string;
    categories: Record<string, unknown>[];
  } = {
    formatVersion: 1,
    binding,
    mode: "access",
    locale: "fa",
    generatedAt: "2026-10-31T12:00:00.000Z",
    categories: context.expectedCategories.map(({ id, sourceStore, decision }, index) => ({
      ...structuredClone(decision),
      id,
      sourceStore,
      ...(decision.disposition === "include" ? { files: categoryFiles[index] } : {}),
    })),
  };
  return { input, context, contactId, messageId };
}
export const signal = () => AbortSignal.timeout(1000);
