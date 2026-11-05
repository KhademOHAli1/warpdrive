import { z } from "zod";
import type { LegalEntity } from "@/features/company-profile/contracts";
import type { BillingDraft } from "./types";
/** Local draft only. Stripe customer data is written exclusively by the existing confirmed checkout. */
export function companyBillingDraft(
  entity: LegalEntity,
  payer: { billingEmail: string },
): BillingDraft | null {
  if (entity.archived) return null;
  const d = entity.data,
    a = d.registeredAddress;
  return {
    name: d.legalName,
    email: payer.billingEmail || d.issuerDefaults.invoiceEmail,
    line1: a.line1,
    line2: a.line2,
    city: a.city,
    state: a.state,
    postalCode: a.postalCode,
    country: a.country || d.country,
    taxId: d.taxIds.find((v) => v.type === "vat" && v.country === d.country)?.value ?? "",
  };
}

const draftSchema = z.strictObject({
  name: z.string(),
  email: z.string(),
  line1: z.string(),
  line2: z.string(),
  city: z.string(),
  state: z.string(),
  postalCode: z.string(),
  country: z.string(),
  taxId: z.string(),
});
export const companyBillingPrefillSchema = z.strictObject({
  entries: z.array(z.strictObject({ id: z.uuid(), draft: draftSchema })),
  preferredId: z.uuid().nullable(),
});
export type CompanyBillingPrefill = z.infer<typeof companyBillingPrefillSchema>;
/** Export only checkout inputs, never other contacts, bank details or issuer configuration. */
export function companyBillingPrefill(
  entities: LegalEntity[],
  payer: { payerLegalEntityId: string | null; billingEmail: string } | null,
): CompanyBillingPrefill {
  const entries = entities.flatMap((entity) => {
    const draft = companyBillingDraft(entity, {
      billingEmail: payer?.payerLegalEntityId === entity.id ? payer.billingEmail : "",
    });
    return draft === null ? [] : [{ id: entity.id, draft }];
  });
  return { entries, preferredId: payer?.payerLegalEntityId ?? null };
}
