/** Extracted checkout guard. Subscription state comes from a fresh Stripe read. */
export function checkoutBlocksPurchase(
  checkoutStatus: string | null,
  subscriptionStatus: string | null,
): boolean {
  if (checkoutStatus === "expired") return false;
  if (checkoutStatus !== "complete") return true;
  return subscriptionStatus !== "canceled" && subscriptionStatus !== "incomplete_expired";
}
