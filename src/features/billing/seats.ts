import { createHash } from "node:crypto";
import type { BillingConfig } from "./config";
import {
  BILLING_RETRY_WINDOW_MS,
  BillingError,
  type BillingStore,
  type BillingTransaction,
} from "./contracts";
import {
  readSeatQuote,
  type SeatQuote,
  signSeatQuote,
  subscriptionFingerprint,
} from "./seatQuotes";
import { subscriptionSnapshot } from "./snapshot";
import type { StripeGateway } from "./stripe/gateway";

type Gateway = Pick<
  StripeGateway,
  "retrieveSubscription" | "previewSeats" | "changeSeats" | "validatePrices"
>;
type Actor = { id: string; authorize: () => Promise<void> };
export class BillingSeatService {
  constructor(
    private readonly store: BillingStore,
    private readonly stripe: Gateway,
    private readonly config: BillingConfig,
    private readonly now = () => new Date(),
  ) {}

  private async current(tx: BillingTransaction) {
    if (tx.account.customerId === null || !tx.account.subscription)
      throw new BillingError("not_ready");
    const sub = await this.stripe.retrieveSubscription(tx.account.subscription.subscriptionId);
    const snapshot = subscriptionSnapshot(sub, tx.account, this.config);
    if (sub.status !== "active" || sub.cancel_at_period_end || sub.pending_update)
      throw new BillingError("not_ready");
    return { sub, snapshot };
  }
  private async seatsAvailable(totalSeats: number) {
    if (totalSeats < (await this.store.activeUserCount())) throw new BillingError("invalid_input");
  }
  async preview(totalSeats: number) {
    await this.seatsAvailable(totalSeats);
    return this.store.withAccount(this.config.livemode === true, async (tx) => {
      const { sub, snapshot } = await this.current(tx);
      if (snapshot.purchasedSeats === Math.max(this.config.includedSeats, totalSeats))
        throw new BillingError("request_conflict");
      await this.stripe.validatePrices(snapshot.interval);
      const prorationDate = Math.floor(this.now().getTime() / 1000);
      const seatItemId =
        sub.items.data.find((item) => item.price.id === this.config.seatPriceIds[snapshot.interval])
          ?.id ?? null;
      const invoice = await this.stripe.previewSeats(
        sub.id,
        snapshot.interval,
        totalSeats,
        seatItemId,
        prorationDate,
      );
      const quote: SeatQuote = {
        version: 1,
        accountId: tx.account.id,
        subscriptionId: sub.id,
        seatItemId,
        interval: snapshot.interval,
        totalSeats,
        priorFingerprint: subscriptionFingerprint(sub),
        prorationDate,
        expiresAt: prorationDate + 15 * 60,
        amountDue: invoice.amount_due,
        currency: "eur",
      };
      return {
        quote: signSeatQuote(quote, this.config.secretKey),
        amountDue: invoice.amount_due,
        currency: invoice.currency,
        expiresAt: quote.expiresAt,
        purchasedSeats: Math.max(this.config.includedSeats, totalSeats),
        isEstimate: true,
      };
    });
  }
  async confirm(token: string, requestId: string, actor: Actor) {
    const quote = readSeatQuote(token, this.config.secretKey);
    const fingerprint = createHash("sha256").update(token).digest("hex");
    await this.seatsAvailable(quote.totalSeats);
    const op = await this.store.withAccount(this.config.livemode === true, async (tx) => {
      if (
        quote.accountId !== tx.account.id ||
        quote.subscriptionId !== tx.account.subscription?.subscriptionId
      )
        throw new BillingError("request_conflict");
      const existing = await tx.operation("seats", requestId);
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new BillingError("request_conflict");
        if (
          existing.resourceId === null &&
          this.now().getTime() - existing.startedAt.getTime() >= BILLING_RETRY_WINDOW_MS
        )
          throw new BillingError("reconciliation_required");
        return existing;
      }
      if (quote.expiresAt <= Math.floor(this.now().getTime() / 1000))
        throw new BillingError("request_conflict");
      if (tx.account.seatOperationId !== null) {
        const pending = await tx.operationById(tx.account.seatOperationId);
        if (pending?.resourceId == null) throw new BillingError("reconciliation_required");
      }
      const { sub } = await this.current(tx);
      if (subscriptionFingerprint(sub) !== quote.priorFingerprint)
        throw new BillingError("request_conflict");
      const invoice = await this.stripe.previewSeats(
        sub.id,
        quote.interval,
        quote.totalSeats,
        quote.seatItemId,
        quote.prorationDate,
      );
      if (invoice.amount_due !== quote.amountDue) throw new BillingError("request_conflict");
      const reserved = await tx.reserveOperation("seats", requestId, fingerprint);
      await tx.saveAccount({ seatOperationId: reserved.id });
      await tx.audit("billing.seats.requested", actor.id, {
        totalSeats: quote.totalSeats,
        amountDue: quote.amountDue,
        currency: quote.currency,
      });
      return reserved;
    });
    if (op.resourceId === null) {
      await actor.authorize();
      await this.stripe.changeSeats(
        quote.subscriptionId,
        quote.interval,
        quote.totalSeats,
        quote.seatItemId,
        quote.prorationDate,
        `warpdrive:seats:${op.id}`,
      );
    }
    return this.store.withAccount(this.config.livemode === true, async (tx) => {
      // Only canonical paid/current subscription items grant capacity, never the requested count.
      const sub = await this.stripe.retrieveSubscription(quote.subscriptionId);
      const snapshot = subscriptionSnapshot(sub, tx.account, this.config);
      await tx.saveAccount({ subscription: snapshot, syncState: "current", syncedAt: this.now() });
      await tx.completeOperation(op.id, sub.id);
      await tx.audit("billing.seats.reconciled", actor.id, { pending: sub.pending_update != null });
      return {
        subscription: snapshot,
        pending: sub.pending_update != null,
        latestInvoiceId: sub.latest_invoice ?? null,
      };
    });
  }
}
