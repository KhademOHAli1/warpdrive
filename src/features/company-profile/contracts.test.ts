import { describe, expect, it } from "vitest";
import { companyCommandSchema, companyDetailsSchema, legalEntityDataSchema } from "./contracts";
import { identityReadiness, readableForeground } from "./readiness";

describe("company profile input boundaries", () => {
  it("keeps optional enrichment optional and never treats team size as seats", () => {
    const data = companyDetailsSchema.parse({ companyName: "A Studio" });
    expect(data.website).toBe("");
    expect(data.industryCode).toBeNull();
    expect(data.intendedTeamSize).toBeNull();
    expect(data.operatingCountries).toEqual([]);
    expect(
      companyDetailsSchema.safeParse({ companyName: "A", website: "javascript:alert(1)" }).success,
    ).toBe(false);
  });
  it("rejects provider verification and server branding claims from browsers", () => {
    expect(companyDetailsSchema.safeParse({ companyName: "A", verified: true }).success).toBe(
      false,
    );
    expect(
      companyCommandSchema.safeParse({
        action: "save_branding",
        requestId: crypto.randomUUID(),
        expectedRevision: 0,
        branding: {
          iconAssetId: null,
          logoAssetId: null,
          accentColor: "#223344",
          fit: "contain",
          iconUrl: "https://attacker.test",
        },
      }).success,
    ).toBe(false);
  });
  it("accepts partial legal records and reports identity completeness honestly", () => {
    const data = legalEntityDataSchema.parse({ legalName: "A GmbH", country: "DE" });
    expect(identityReadiness(data)).toEqual({
      status: "incomplete",
      missing: [
        "registeredAddress.line1",
        "registeredAddress.city",
        "registeredAddress.postalCode",
      ],
      scope: "identity_record_only",
    });
    expect(data.issuerDefaults.taxRegime).toBe("unknown");
    expect(
      legalEntityDataSchema.safeParse({ legalName: "A", country: "DE", verified: true }).success,
    ).toBe(false);
  });
  it("chooses readable text for very light and dark accents", () => {
    expect(readableForeground("#ffffff")).toBe("#000000");
    expect(readableForeground("#000000")).toBe("#ffffff");
  });
});

it("accepts explicit original-action cancellation without revision or private payload", () => {
  expect(
    companyCommandSchema.safeParse({
      action: "cancel_operation",
      requestId: crypto.randomUUID(),
      operationId: crypto.randomUUID(),
      operationAction: "save_legal_entity",
    }).success,
  ).toBe(true);
});
