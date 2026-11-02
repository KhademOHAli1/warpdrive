export { currentCaseIdentityBinding } from "./identityBinding";
export { changePrivacyCaseRecipient } from "./identityRecipient";
export { verifyPrivacyCaseIdentity } from "./identityReview";
export { verifyOwnPrivacyIdentity } from "./identitySelf";

// The public handler may acknowledge intake but must not reveal matches or claim message delivery.
export function privacyIntakeAcknowledgement() {
  return { accepted: true } as const;
}
