import type { BillingMessages } from "../messages";
import type { BillingOverview, BillingProfile } from "./api";

export type BillingDraft = {
  name: string;
  email: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  taxId: string;
};

export type BillingCountryOption = { value: string; label: string };

export function emptyBillingDraft(country: string): BillingDraft {
  return {
    name: "",
    email: "",
    line1: "",
    line2: "",
    city: "",
    state: "",
    postalCode: "",
    country,
    taxId: "",
  };
}

export function billingDraftFromCustomer(
  customer: NonNullable<BillingOverview["customer"]>,
  fallbackCountry: string,
): BillingDraft {
  return {
    name: customer.name ?? "",
    email: customer.email ?? "",
    line1: customer.address?.line1 ?? "",
    line2: customer.address?.line2 ?? "",
    city: customer.address?.city ?? "",
    state: customer.address?.state ?? "",
    postalCode: customer.address?.postal_code ?? "",
    country: customer.address?.country ?? fallbackCountry,
    taxId: customer.taxIds?.data[0]?.value ?? "",
  };
}

export function billingProfileFromDraft(draft: BillingDraft): BillingProfile {
  const profile: BillingProfile = {
    name: draft.name.trim(),
    email: draft.email.trim(),
    address: {
      line1: draft.line1.trim(),
      city: draft.city.trim(),
      postalCode: draft.postalCode.trim(),
      country: draft.country,
    },
  };
  if (draft.line2.trim() !== "") profile.address.line2 = draft.line2.trim();
  if (draft.state.trim() !== "") profile.address.state = draft.state.trim();
  if (draft.taxId.trim() !== "") profile.taxId = { type: "eu_vat", value: draft.taxId.trim() };
  return profile;
}

export function hasCompleteBillingProfile(draft: BillingDraft): boolean {
  return [draft.name, draft.email, draft.line1, draft.city, draft.postalCode, draft.country].every(
    (value) => value.trim() !== "",
  );
}

export function billingErrorMessage(messages: BillingMessages, code: string): string {
  if (Object.hasOwn(messages.errors, code))
    return messages.errors[code as keyof typeof messages.errors];
  return messages.errors.unknown;
}
