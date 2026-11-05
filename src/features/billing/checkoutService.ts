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
import { recoverCheckout } from "./reconcile";
import type { StripeGateway } from "./stripe";

type Gateway = Pick<
  StripeGateway,
  | "createCustomer"
  | "searchCustomers"
  | "createCheckout"
  | "retrieveCheckout"
  | "listCheckouts"
  | "retrieveSubscription"
  | "validatePrices"
>;
type Actor = { id: string; authorize: () => Promise<void> };
type StripeCheckout = Awaited<ReturnType<StripeGateway["retrieveCheckout"]>>;
type CheckoutReservation = {
  accountId: string;
  customerId: string;
  op: BillingOperation;
  checkout?: StripeCheckout;
};
const terminal = new Set(["canceled", "incomplete_expired"]);
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const operationKey = (op: BillingOperation) => `warpdrive:${op.kind}:${op.id}`;

export function assertCheckoutOwnership(checkout: StripeCheckout, account: BillingAccount) {
  if (
    checkout.customer !== account.customerId ||
    checkout.client_reference_id !== account.id ||
    checkout.metadata.warpdrive_account_id !== account.id ||
    checkout.mode !== "subscription" ||
    checkout.livemode !== account.livemode
  )
    throw new BillingError("reconciliation_required");
}

/** Durable checkout/customer reservations keep provider writes idempotent and account-bound. */
export class BillingCheckoutService {
  constructor(
    private readonly store: BillingStore,
    private readonly stripe: Gateway,
    private readonly config: BillingConfig,
    private readonly sync: (tx: BillingTransaction) => Promise<unknown>,
    private readonly now = () => new Date(),
  ) {}

  private mode() {
    return this.config.livemode === true;
  }
  private retryable(op: BillingOperation) {
    if (this.now().getTime() - op.startedAt.getTime() >= BILLING_RETRY_WINDOW_MS)
      throw new BillingError("reconciliation_required");
  }
  private async customer(
    profile: Extract<BillingCommand, { action: "checkout" }>["profile"],
    actor: Actor,
  ) {
    const fingerprint = digest(profile);
    const reserved = await this.store.withAccount(this.mode(), async (tx) => {
      if (tx.account.syncState === "needs_review")
        throw new BillingError("reconciliation_required");
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
  private async requireRetiredCheckout(checkout: StripeCheckout, account: BillingAccount) {
    let status: string | null = null;
    if (checkout.subscription !== null) {
      const sub = await this.stripe.retrieveSubscription(checkout.subscription);
      if (
        sub.customer !== account.customerId ||
        sub.metadata.warpdrive_account_id !== account.id ||
        sub.livemode !== account.livemode
      )
        throw new BillingError("reconciliation_required");
      status = sub.status;
    }
    if (checkoutBlocksPurchase(checkout.status, status))
      throw new BillingError("checkout_in_progress");
  }
  private async recoverForActiveSubscription(tx: BillingTransaction, own: BillingOperation) {
    if (tx.account.checkoutOperationId !== own.id)
      throw new BillingError("reconciliation_required");
    const recovered = await recoverCheckout(tx, this.stripe);
    if (recovered === null) throw new BillingError("reconciliation_required");
    assertCheckoutOwnership(recovered.checkout, tx.account);
    if (
      recovered.checkout.status !== "complete" ||
      recovered.checkout.subscription !== tx.account.subscription?.subscriptionId
    )
      throw new BillingError("reconciliation_required");
    await tx.completeOperation(own.id, recovered.checkout.id);
    return recovered.checkout;
  }

  private async replayExistingCheckout(
    tx: BillingTransaction,
    own: BillingOperation,
    fingerprint: string,
  ): Promise<CheckoutReservation> {
    if (own.fingerprint !== fingerprint) throw new BillingError("request_conflict");
    if (own.resourceId !== null) {
      const existing = await this.stripe.retrieveCheckout(own.resourceId);
      assertCheckoutOwnership(existing, tx.account);
      await this.sync(tx);
      if (
        tx.account.subscription &&
        !terminal.has(tx.account.subscription.status) &&
        (existing.status !== "complete" ||
          existing.subscription !== tx.account.subscription.subscriptionId)
      )
        throw new BillingError("already_subscribed");
      if (tx.account.customerId === null) throw new BillingError("reconciliation_required");
      return {
        accountId: tx.account.id,
        customerId: tx.account.customerId,
        op: own,
        checkout: existing,
      };
    }
    this.retryable(own);
    await this.sync(tx);
    if (tx.account.subscription && !terminal.has(tx.account.subscription.status)) {
      const recovered = await this.recoverForActiveSubscription(tx, own);
      if (tx.account.customerId === null) throw new BillingError("reconciliation_required");
      return {
        accountId: tx.account.id,
        customerId: tx.account.customerId,
        op: { ...own, resourceId: recovered.id },
        checkout: recovered,
      };
    }
    if (tx.account.checkoutOperationId !== own.id)
      throw new BillingError("reconciliation_required");
    if (tx.account.customerId === null) throw new BillingError("reconciliation_required");
    return { accountId: tx.account.id, customerId: tx.account.customerId, op: own };
  }

  private async reserveCheckout(
    tx: BillingTransaction,
    input: Extract<BillingCommand, { action: "checkout" }>,
    actor: Actor,
    fingerprint: string,
  ): Promise<CheckoutReservation> {
    await this.sync(tx);
    if (tx.account.subscription && !terminal.has(tx.account.subscription.status))
      throw new BillingError("already_subscribed");
    if (tx.account.checkoutOperationId !== null) {
      const previous = await tx.operationById(tx.account.checkoutOperationId);
      if (previous?.resourceId == null) throw new BillingError("checkout_in_progress");
      const checkout = await this.stripe.retrieveCheckout(previous.resourceId);
      assertCheckoutOwnership(checkout, tx.account);
      await this.requireRetiredCheckout(checkout, tx.account);
    }
    if (tx.account.customerId === null) throw new BillingError("reconciliation_required");
    const op = await tx.reserveOperation("checkout", input.requestId, fingerprint);
    await tx.saveAccount({ checkoutOperationId: op.id });
    await tx.audit("billing.checkout.requested", actor.id, {
      interval: input.interval,
      totalSeats: input.totalSeats,
    });
    return { accountId: tx.account.id, customerId: tx.account.customerId, op };
  }

  private async reserveOrReplayCheckout(
    tx: BillingTransaction,
    input: Extract<BillingCommand, { action: "checkout" }>,
    actor: Actor,
    fingerprint: string,
  ): Promise<CheckoutReservation> {
    if (tx.account.syncState === "needs_review") throw new BillingError("reconciliation_required");
    const own = await tx.operation("checkout", input.requestId);
    return own
      ? this.replayExistingCheckout(tx, own, fingerprint)
      : this.reserveCheckout(tx, input, actor, fingerprint);
  }

  async checkout(input: Extract<BillingCommand, { action: "checkout" }>, actor: Actor) {
    if (!this.config.allowedCountries.has(input.profile.address.country))
      throw new BillingError("invalid_input");
    if (input.totalSeats < (await this.store.activeUserCount()))
      throw new BillingError("invalid_input");
    await this.stripe.validatePrices(input.interval);
    await this.customer(input.profile, actor);
    const fingerprint = digest({ interval: input.interval, totalSeats: input.totalSeats });
    const reserved = await this.store.withAccount<CheckoutReservation>(this.mode(), (tx) =>
      this.reserveOrReplayCheckout(tx, input, actor, fingerprint),
    );
    if (reserved.checkout !== undefined) return reserved.checkout;
    if (reserved.op.resourceId !== null)
      return this.stripe.retrieveCheckout(reserved.op.resourceId);
    await actor.authorize();
    const checkout = await this.stripe.createCheckout(
      reserved.customerId,
      reserved.accountId,
      input.interval,
      input.totalSeats,
      operationKey(reserved.op),
    );
    await this.store.withAccount(this.mode(), async (tx) => {
      assertCheckoutOwnership(checkout, tx.account);
      await tx.completeOperation(reserved.op.id, checkout.id);
      await tx.audit("billing.checkout.created", actor.id);
    });
    return checkout;
  }
}
