import { createHash } from "node:crypto";
import { checkoutBlocksPurchase } from "./checkoutPolicy";
import type { BillingConfig } from "./config";
import {
  BILLING_RETRY_WINDOW_MS,
  type BillingAccount,
  type BillingCommand,
  BillingError,
  type BillingOperation,
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
const terminal = new Set(["canceled", "incomplete_expired"]);
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const operationKey = (op: BillingOperation) => `warpdrive:${op.kind}:${op.id}`;

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
  private retryable(op: BillingOperation) {
    if (this.now().getTime() - op.startedAt.getTime() >= BILLING_RETRY_WINDOW_MS)
      throw new BillingError("reconciliation_required");
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

  private async customer(
    profile: Extract<BillingCommand, { action: "checkout" }>["profile"],
    actor: Actor,
  ) {
    const fingerprint = digest(profile);
    const reserved = await this.store.withAccount(this.mode(), async (tx) => {
      if (tx.account.customerId !== null) return { account: tx.account, op: null };
      let op = await tx.operation("customer", "initial");
      if (op && op.fingerprint !== fingerprint) throw new BillingError("request_conflict");
      if (!op) op = await tx.reserveOperation("customer", "initial", fingerprint);
      this.retryable(op);
      return { account: tx.account, op };
    });
    if (reserved.account.customerId !== null) return reserved.account.customerId;
    if (!reserved.op) throw new BillingError("not_ready");
    const customerOperation = reserved.op;
    await actor.authorize();
    const customer = await this.stripe.createCustomer(
      reserved.account.id,
      profile,
      operationKey(reserved.op),
    );
    await this.store.withAccount(this.mode(), async (tx) => {
      if (tx.account.customerId !== null && tx.account.customerId !== customer.id)
        throw new BillingError("reconciliation_required");
      await tx.saveAccount({ customerId: customer.id });
      await tx.completeOperation(customerOperation.id, customer.id);
      await tx.audit("billing.customer.created", actor.id);
    });
    return customer.id;
  }

  async checkout(input: Extract<BillingCommand, { action: "checkout" }>, actor: Actor) {
    if (!this.config.allowedCountries.has(input.profile.address.country))
      throw new BillingError("invalid_input");
    if (input.totalSeats < (await this.store.activeUserCount()))
      throw new BillingError("invalid_input");
    // Never accept arbitrary price IDs/currency from the browser.
    await this.stripe.validatePrices(input.interval);
    const customerId = await this.customer(input.profile, actor);
    const fingerprint = digest({ interval: input.interval, totalSeats: input.totalSeats });
    const reserved = await this.store.withAccount(this.mode(), async (tx) => {
      await this.sync(tx);
      if (tx.account.subscription && !terminal.has(tx.account.subscription.status))
        throw new BillingError("already_subscribed");
      const own = await tx.operation("checkout", input.requestId);
      if (own) {
        if (own.fingerprint !== fingerprint) throw new BillingError("request_conflict");
        if (own.resourceId === null) this.retryable(own);
        return { accountId: tx.account.id, op: own };
      }
      if (tx.account.checkoutOperationId !== null) {
        const previous = await tx.operationById(tx.account.checkoutOperationId);
        if (previous?.resourceId == null) throw new BillingError("checkout_in_progress");
        const checkout = await this.stripe.retrieveCheckout(previous.resourceId);
        this.assertCheckout(checkout, tx.account);
        await this.requireRetiredCheckout(checkout, tx.account);
      }
      const op = await tx.reserveOperation("checkout", input.requestId, fingerprint);
      await tx.saveAccount({ checkoutOperationId: op.id });
      await tx.audit("billing.checkout.requested", actor.id, {
        interval: input.interval,
        totalSeats: input.totalSeats,
      });
      return { accountId: tx.account.id, op };
    });
    if (reserved.op.resourceId !== null)
      return this.stripe.retrieveCheckout(reserved.op.resourceId);
    await actor.authorize();
    const checkout = await this.stripe.createCheckout(
      customerId,
      reserved.accountId,
      input.interval,
      input.totalSeats,
      operationKey(reserved.op),
    );
    await this.store.withAccount(this.mode(), async (tx) => {
      this.assertCheckout(checkout, tx.account);
      await tx.completeOperation(reserved.op.id, checkout.id);
      await tx.audit("billing.checkout.created", actor.id);
    });
    return checkout;
  }

  private async requireRetiredCheckout(
    checkout: Awaited<ReturnType<StripeGateway["retrieveCheckout"]>>,
    account: BillingAccount,
  ) {
    let status: string | null = null;
    if (checkout.status === "complete" && checkout.subscription !== null) {
      const sub = await this.stripe.retrieveSubscription(checkout.subscription);
      if (sub.customer !== account.customerId || sub.metadata.warpdrive_account_id !== account.id)
        throw new BillingError("reconciliation_required");
      status = sub.status;
    }
    if (checkoutBlocksPurchase(checkout.status, status))
      throw new BillingError("checkout_in_progress");
  }
  private assertCheckout(
    checkout: Awaited<ReturnType<StripeGateway["retrieveCheckout"]>>,
    account: BillingAccount,
  ) {
    if (
      checkout.customer !== account.customerId ||
      checkout.client_reference_id !== account.id ||
      checkout.metadata.warpdrive_account_id !== account.id ||
      checkout.mode !== "subscription" ||
      checkout.livemode !== account.livemode
    )
      throw new BillingError("reconciliation_required");
  }
  private async account() {
    const account = await this.store.readAccount(this.mode());
    if (account?.customerId == null) throw new BillingError("not_ready");
    return account as BillingAccount & { customerId: string };
  }

  async overview() {
    const activeUsers = await this.store.activeUserCount();
    return this.store.withAccount(this.mode(), async (tx) => {
      const customer = await this.sync(tx);
      return {
        configured: true,
        customer: customerSummary(customer),
        subscription: tx.account.subscription,
        syncedAt: tx.account.syncedAt,
        syncState: tx.account.syncState,
        activeUsers,
        includedSeats: this.config.includedSeats,
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
      if (!(await recoverCustomer(tx, this.stripe))) return { recovered: false };
      const recovered = await recoverCheckout(tx, this.stripe);
      if (recovered !== null) {
        this.assertCheckout(recovered.checkout, tx.account);
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
