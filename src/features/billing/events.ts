import { BillingError, type BillingStore, type BillingTransaction } from "./contracts";
import type { VerifiedStripeEvent } from "./stripe/schemas";
export async function processBillingEvent(
  store: BillingStore,
  mode: boolean,
  event: VerifiedStripeEvent,
  bodyDigest: string,
  sync: (tx: BillingTransaction) => Promise<unknown>,
  now: () => Date,
) {
  if (event.livemode !== mode) throw new BillingError("invalid_input");
  const object = event.data.object;
  const customerId =
    event.type.startsWith("customer.") &&
    !event.type.startsWith("customer.subscription.") &&
    !event.type.startsWith("customer.tax_id.")
      ? object.id
      : typeof object.customer === "string"
        ? object.customer
        : null;
  const account = await store.readAccount(mode);
  if (account?.customerId == null || customerId !== account.customerId) return { ignored: true };
  return store.withAccount(mode, async (tx) => {
    if (await tx.hasEvent(event.id)) return { duplicate: true };
    // Re-fetch current Stripe state under the account lock; event delivery order is not state order.
    if (event.type === "customer.deleted") {
      await tx.saveAccount({
        subscription: null,
        syncState: "needs_review",
        syncedAt: now(),
      });
    } else {
      await sync(tx);
    }
    await tx.completeEvent({
      id: event.id,
      type: event.type,
      digest: bodyDigest,
      created: event.created,
    });
    await tx.audit("billing.webhook.processed", null, { type: event.type });
    return { processed: true };
  });
}
