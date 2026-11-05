import type { BillingConfig } from "./config";
import { type BillingAccount, BillingError, type SubscriptionSnapshot } from "./contracts";
import type { StripeSubscription } from "./stripe/schemas";

export function subscriptionSnapshot(
  sub: StripeSubscription,
  account: BillingAccount,
  config: BillingConfig,
): SubscriptionSnapshot {
  if (
    sub.customer !== account.customerId ||
    sub.livemode !== account.livemode ||
    sub.metadata.warpdrive_account_id !== account.id ||
    sub.items.has_more
  )
    throw new BillingError("reconciliation_required");
  const workspace = sub.items.data.filter((item) =>
    Object.values(config.workspacePriceIds).includes(item.price.id),
  );
  if (workspace.length !== 1) throw new BillingError("reconciliation_required");
  const base = workspace[0];
  if (base === undefined) throw new BillingError("reconciliation_required");
  const interval = base.price.id === config.workspacePriceIds.monthly ? "monthly" : "yearly";
  const seats = sub.items.data.filter((item) => item.price.id === config.seatPriceIds[interval]);
  if (
    base.quantity !== 1 ||
    seats.length > 1 ||
    sub.items.data.length !== 1 + seats.length ||
    base.price.currency !== "eur" ||
    base.price.recurring?.interval !== (interval === "monthly" ? "month" : "year") ||
    base.price.recurring.interval_count !== 1
  )
    throw new BillingError("reconciliation_required");
  for (const item of sub.items.data) {
    if (
      item.price.livemode !== config.livemode ||
      item.price.currency !== "eur" ||
      item.price.recurring?.interval !== base.price.recurring.interval ||
      item.price.recurring.interval_count !== 1 ||
      item.price.recurring.usage_type !== "licensed"
    )
      throw new BillingError("reconciliation_required");
  }
  const purchasedSeats = config.includedSeats + (seats[0]?.quantity ?? 0);
  if (!Number.isSafeInteger(purchasedSeats) || purchasedSeats < 1 || purchasedSeats > 10_000)
    throw new BillingError("reconciliation_required");
  return {
    subscriptionId: sub.id,
    status: sub.status,
    interval,
    purchasedSeats,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    currentPeriodEnd: base.current_period_end,
    latestInvoiceId: sub.latest_invoice ?? null,
  };
}
