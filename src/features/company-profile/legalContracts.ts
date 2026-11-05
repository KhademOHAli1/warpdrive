import { z } from "zod";
import { contactSchema, country, email, optionalCountry, text, webUrl } from "./fields";

export const issuerDefaultsSchema = z.strictObject({
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .or(z.literal(""))
    .default(""),
  language: z.enum(["", "en", "de", "fa"]).default(""),
  paymentTermsDays: z.number().int().min(0).max(365).nullable().default(null),
  numberingSeries: text(100),
  taxRegime: z.enum(["unknown", "standard", "small_business", "exempt"]).default("unknown"),
  exemptionReason: text(1000),
  legalFooter: text(4000),
  paymentInstructions: text(2000),
  payeeName: text(),
  iban: z
    .string()
    .trim()
    .max(34)
    .regex(/^$|^[A-Z]{2}[0-9A-Z ]{10,32}$/)
    .default(""),
  bic: z
    .string()
    .trim()
    .max(11)
    .regex(/^$|^[A-Z0-9]{8}([A-Z0-9]{3})?$/)
    .default(""),
  invoiceEmail: email,
  structuredProfile: z.enum(["none", "xrechnung", "zugferd", "other"]).default("none"),
  electronicAddress: text(300),
  electronicAddressScheme: text(100),
});
export const legalEntityDataSchema = z.strictObject({
  legalName: z.string().trim().min(1).max(200),
  tradingName: text(),
  country,
  legalForm: text(100),
  registeredSeat: text(),
  registeredAddress: z
    .strictObject({
      line1: text(),
      line2: text(),
      city: text(),
      state: text(),
      postalCode: text(30),
      country: optionalCountry,
    })
    .prefault({}),
  registrationNumber: text(100),
  registerAuthority: text(),
  taxIds: z
    .array(
      z.strictObject({
        type: z.enum(["vat", "tax_number", "other"]),
        country: optionalCountry,
        value: z.string().trim().min(1).max(100),
      }),
    )
    .max(20)
    .default([]),
  representatives: z.array(contactSchema).max(20).default([]),
  contacts: z.array(contactSchema).max(30).default([]),
  parentEntityId: z.uuid().nullable().default(null),
  source: z
    .strictObject({
      kind: z.enum(["manual", "registry", "website", "import"]).default("manual"),
      url: webUrl,
      recordId: text(200),
    })
    .prefault({}),
  issuerDefaults: issuerDefaultsSchema.prefault({}),
});
export const payerPreferencesSchema = z.strictObject({
  payerLegalEntityId: z.uuid().nullable().default(null),
  financeContact: contactSchema.nullable().default(null),
  procurementContact: contactSchema.nullable().default(null),
  purchaseOrderReference: text(200),
  billingEmail: email,
  electronicInvoiceAddress: text(300),
  electronicInvoiceScheme: text(100),
});
export const identityReadinessSchema = z.strictObject({
  status: z.enum(["ready", "incomplete"]),
  missing: z.array(z.string()),
  scope: z.literal("identity_record_only"),
});
export const provenanceSchema = z.strictObject({
  kind: z.enum(["manual", "registry", "website", "import"]),
  confirmedAt: z.string(),
  provider: z.string().nullable(),
  checkedAt: z.string().nullable(),
  checkedFields: z.array(z.string().max(100)).max(100).default([]),
  verification: z.enum(["self_reported", "provider_checked"]),
});
export const legalEntitySchema = z.strictObject({
  id: z.uuid(),
  revision: z.number().int(),
  data: legalEntityDataSchema,
  archived: z.boolean(),
  confirmedAt: z.string(),
  readiness: identityReadinessSchema,
  provenance: provenanceSchema,
});
export type LegalEntityData = z.infer<typeof legalEntityDataSchema>;
export type LegalEntity = z.infer<typeof legalEntitySchema>;
export type PayerPreferences = z.infer<typeof payerPreferencesSchema>;
export type CompanyProvenance = z.infer<typeof provenanceSchema>;
