import { assertCheckoutOwnership, BillingCheckoutService } from "./checkoutService";
import type { BillingConfig } from "./config";
import {
  type BillingAccount,
  type BillingCommand,
  BillingError,
  type BillingStore,
  type BillingTransaction,
} from "./contracts";
import { customerSummary, ownedDocumentUrl } from "./documents";
import { processBillingEvent } from "./events";
import { recoverCheckout, recoverCustomer } from "./reconcile";
import { BillingSeatService } from "./seats";
import { subscriptionSnapshot } from "./snapshot";
import type { StripeGateway, StripeSubscription, VerifiedStripeEvent } from "./stripe";

type Gateway = Pick<
  StripeGateway,
  | "createCustomer"
  | "retrieveCustomer"
  | "searchCustomers"
  | "createCheckout"
  | "retrieveCheckout"
  | "listCheckouts"
  | "validatePrices"
  | "listSubscriptions"
  | "createPortal"
  | "listInvoices"
  | "retrieveInvoice"
  | "listReceipts"
  | "retrieveCharge"
  | "listPaymentMethods"
  | "retrieveSubscription"
  | "previewSeats"
  | "changeSeats"
>;
type Actor = { id: string; authorize: () => Promise<void> };
type StripeCheckout = Awaited<ReturnType<StripeGateway["retrieveCheckout"]>>;
const terminal = new Set(["canceled", "incomplete_expired"]);

/** Provider side effects run only after their stable operation key has committed locally. */
export class BillingService {
  constructor(
    private readonly store: BillingStore,
    private readonly stripe: Gateway,
    private readonly config: BillingConfig,
    private readonly now = () => new Date(),
  ) {}

  private mode() {
    return this.config.livemode === true;
  }
  private async subscriptions(customerId: string) {
    const subscriptions: StripeSubscription[] = [];
    let cursor: string | undefined;
    const seen = new Set<string>();
    for (let page = 0; page < 10; page++) {
      const result = await this.stripe.listSubscriptions(customerId, cursor);
      subscriptions.push(...result.data);
      if (!result.has_more) return subscriptions;
      if (result.next_cursor === null || seen.has(result.next_cursor))
        throw new BillingError("reconciliation_required");
      seen.add(result.next_cursor);
      cursor = result.next_cursor;
    }
    throw new BillingError("reconciliation_required");
  }
  private async sync(tx: BillingTransaction) {
    if (tx.account.syncState === "needs_review" && tx.account.customerId !== null)
      throw new BillingError("reconciliation_required");
    if (tx.account.customerId === null) return null;
    const customer = await this.stripe.retrieveCustomer(tx.account.customerId);
    if (customer.metadata.warpdrive_account_id !== tx.account.id)
      throw new BillingError("reconciliation_required");
    const all = await this.subscriptions(customer.id);
    const active = all.filter((sub) => !terminal.has(sub.status));
    if (active.length > 1) throw new BillingError("reconciliation_required");
    const selected = active[0] ?? all[0];
    const subscription = selected ? subscriptionSnapshot(selected, tx.account, this.config) : null;
    await tx.saveAccount({ subscription, syncedAt: this.now(), syncState: "current" });
    return customer;
  }

  async checkout(input: Extract<BillingCommand, { action: "checkout" }>, actor: Actor) {
    return new BillingCheckoutService(
      this.store,
      this.stripe,
      this.config,
      (tx) => this.sync(tx),
      this.now,
    ).checkout(input, actor);
  }

  private async pendingCheckout(tx: BillingTransaction) {
    if (tx.account.checkoutOperationId === null) return null;
    const operation = await tx.operationById(tx.account.checkoutOperationId);
    if (operation === null) return null;
    let checkout: StripeCheckout;
    if (operation.resourceId !== null) {
      checkout = await this.stripe.retrieveCheckout(operation.resourceId);
    } else {
      let recovered: Awaited<ReturnType<typeof recoverCheckout>>;
      try {
        recovered = await recoverCheckout(tx, this.stripe);
      } catch (error) {
        if (error instanceof BillingError && error.code === "reconciliation_required") return null;
        throw error;
      }
      if (recovered === null) return null;
      checkout = recovered.checkout;
      assertCheckoutOwnership(checkout, tx.account);
      await tx.completeOperation(operation.id, checkout.id);
    }
    assertCheckoutOwnership(checkout, tx.account);
    const activeSubscription =
      tx.account.subscription !== null && !terminal.has(tx.account.subscription.status);
    return {
      id: checkout.id,
      status: checkout.status,
      url: !activeSubscription && checkout.status === "open" ? checkout.url : null,
      expiresAt: checkout.expires_at,
    };
  }

  private async account() {
    const account = await this.store.readAccount(this.mode());
    if (account?.syncState === "needs_review") throw new BillingError("reconciliation_required");
    if (account?.customerId == null) throw new BillingError("not_ready");
    return account as BillingAccount & { customerId: string };
  }

  async overview() {
    const activeUsers = await this.store.activeUserCount();
    return this.store.withAccount(this.mode(), async (tx) => {
      const customer = await this.sync(tx);
      const pendingCheckout = await this.pendingCheckout(tx);
      return {
        configured: true,
        customer: customerSummary(customer),
        subscription: tx.account.subscription,
        syncedAt: tx.account.syncedAt,
        syncState: tx.account.syncState,
        activeUsers,
        includedSeats: this.config.includedSeats,
        pendingCheckout,
        currency: "eur",
        livemode: this.mode(),
        // Billing status is deliberately not payout/settlement status or a new global CRM access gate.
        paymentMethodsManagedBy: "stripe_customer_portal",
      };
    });
  }

  async portal(intent: "overview" | "payment_methods" | "cancel", actor: Actor) {
    return this.store.withAccount(this.mode(), async (tx) => {
      await this.sync(tx);
      if (tx.account.syncState === "needs_review")
        throw new BillingError("reconciliation_required");
      if (tx.account.customerId === null) throw new BillingError("not_ready");
      if (
        intent === "cancel" &&
        (!tx.account.subscription || terminal.has(tx.account.subscription.status))
      )
        throw new BillingError("not_ready");
      await actor.authorize();
      const portal = await this.stripe.createPortal(
        tx.account.customerId,
        intent,
        tx.account.subscription?.subscriptionId,
      );
      await tx.audit("billing.portal.created", actor.id, { intent });
      return { url: portal.url };
    });
  }

  async previewSeats(totalSeats: number) {
    return new BillingSeatService(this.store, this.stripe, this.config, this.now).preview(
      totalSeats,
    );
  }

  async changeSeats(quote: string, requestId: string, actor: Actor) {
    return new BillingSeatService(this.store, this.stripe, this.config, this.now).confirm(
      quote,
      requestId,
      actor,
    );
  }

  async invoices(cursor?: string) {
    return this.stripe.listInvoices((await this.account()).customerId, cursor);
  }

  async receipts(cursor?: string) {
    return this.stripe.listReceipts((await this.account()).customerId, cursor);
  }

  async paymentMethods(cursor?: string) {
    return this.stripe.listPaymentMethods((await this.account()).customerId, cursor);
  }

  async document(kind: "invoice" | "receipt", id: string, actorId: string) {
    const account = await this.account();
    const url = await ownedDocumentUrl(this.stripe, account.customerId, kind, id);
    await this.store.withAccount(this.mode(), (tx) =>
      tx.audit("billing.document.accessed", actorId, { kind }),
    );
    return url;
  }

  async reconcile(actor: Actor) {
    return this.store.withAccount(this.mode(), async (tx) => {
      await actor.authorize();
      if (tx.account.syncState === "needs_review" && tx.account.customerId !== null)
        throw new BillingError("reconciliation_required");
      if (!(await recoverCustomer(tx, this.stripe))) return { recovered: false };
      if (tx.account.syncState === "needs_review")
        await tx.saveAccount({ syncState: "never", syncedAt: null });
      const recovered = await recoverCheckout(tx, this.stripe);
      if (recovered !== null) {
        assertCheckoutOwnership(recovered.checkout, tx.account);
        await tx.completeOperation(recovered.op.id, recovered.checkout.id);
      }
      await this.sync(tx);
      await tx.audit("billing.reconciled", actor.id);
      return { recovered: true, subscription: tx.account.subscription };
    });
  }

  async webhook(event: VerifiedStripeEvent, bodyDigest: string) {
    return processBillingEvent(
      this.store,
      this.mode(),
      event,
      bodyDigest,
      (tx) => this.sync(tx),
      this.now,
    );
  }
}
