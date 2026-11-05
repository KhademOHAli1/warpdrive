import { expect, it } from "vitest";
import { legalEntityDataSchema, legalEntitySchema } from "@/features/company-profile/contracts";
import { companyBillingDraft, companyBillingPrefill } from "./companyPrefill";

it("copies only the explicitly selected active legal payer and billing contact, without treating company size as seats", () => {
  const data = legalEntityDataSchema.parse({
    legalName: "Legal GmbH",
    country: "DE",
    registeredAddress: { line1: "Street 1", city: "Berlin", postalCode: "10115", country: "DE" },
    taxIds: [
      { type: "tax_number", country: "DE", value: "private-tax-number" },
      { type: "vat", country: "DE", value: "DE123456789" },
    ],
  });
  const entity = legalEntitySchema.parse({
    id: "00000000-0000-4000-8000-000000000001",
    revision: 1,
    data,
    archived: false,
    confirmedAt: "2026-11-05",
    readiness: { status: "ready", missing: [], scope: "identity_record_only" },
    provenance: {
      kind: "manual",
      confirmedAt: "2026-11-05",
      provider: null,
      checkedAt: null,
      verification: "self_reported",
    },
  });
  const draft = companyBillingDraft(entity, { billingEmail: "finance@example.test" });
  expect(draft).toMatchObject({
    name: "Legal GmbH",
    email: "finance@example.test",
    taxId: "DE123456789",
    country: "DE",
  });
  expect(draft).not.toHaveProperty("seats");
  const copy = companyBillingPrefill([entity, { ...entity, archived: true }], {
    payerLegalEntityId: entity.id,
    billingEmail: "finance@example.test",
  });
  expect(copy.entries).toEqual([{ id: entity.id, draft }]);
  expect(copy.preferredId).toBe(entity.id);
  expect(JSON.stringify(copy)).not.toContain("private-tax-number");
  expect(companyBillingDraft({ ...entity, archived: true }, { billingEmail: "" })).toBeNull();
});
