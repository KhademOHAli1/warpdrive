export type NewsletterIdentityState =
  | "pending"
  | "verified"
  | "confirmed"
  | "expired"
  | "detached"
  | "unknown"
  | "suppressed"
  | "erased";

export type IdentityCommandResult = { id: string; state: NewsletterIdentityState };

export type NewsletterPurposeConsent = {
  id: number;
  name: string;
  optin: "single" | "double";
  status: "active" | "archived";
  subscriptionStatus: "unconfirmed" | "confirmed" | "unsubscribed";
};

export type PersonNewsletterLink = {
  id: string;
  subscriberId: number | null;
  subscriberUuid: string | null;
  state: "pending" | "verified" | "expired" | "detached";
  shared: boolean;
  verifiedAt: Date | null;
  consent: {
    status: "enabled" | "blocklisted" | "disabled";
    lists: NewsletterPurposeConsent[];
  } | null;
};

export type PersonNewsletterSummary = {
  personId: string;
  engineAvailable: boolean;
  deliveryAvailable: boolean;
  eligibleLists: Array<{ id: number; name: string }>;
  addresses: Array<{ address: string; links: PersonNewsletterLink[] }>;
};

export type PersonNewsletterEvent = {
  id: string;
  personId: string;
  linkId: string;
  listId: number | null;
  event: "newsletter.identity.verified" | "newsletter.consent.confirmed";
  occurredAt: Date;
  originRunId: string | null;
};

export type NewsletterGrant = {
  grantUuid: string;
  bindingUuid: string;
  subscriberId: number;
  subscriberUuid: string;
  email: string;
  purposeListId: number;
};

export type PersonNewsletterGrant = NewsletterGrant & { personId: string };

export const maxNewsletterAudiencePeople = 1_000;
