import { randomUUID } from "node:crypto";
import { z } from "zod";
import { StripeProviderError } from "./errors";
import {
  type BillingInterval,
  billingIntervalSchema,
  priceIdSchema,
  stripeIdSchema,
  stripePageSchema,
  stripePriceSchema,
  stripeSubscriptionSchema,
  subscriptionIdSchema,
} from "./schemas";

import { StripeTransport } from "./transport";

function input<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new StripeProviderError("invalid_input");
  return parsed.data;
}

export class StripeSubscriptionGateway extends StripeTransport {
  async retrievePrice(id: string) {
    const priceId = input(priceIdSchema, id);
    const result = await this.request("GET", `/prices/${priceId}`, stripePriceSchema);
    this.assertMode(result);
    if (result.id !== priceId) throw new StripeProviderError("invalid_response");
    return result;
  }

  async validatePrices(interval: BillingInterval) {
    const selected = input(billingIntervalSchema, interval);
    if (this.workspacePrices[selected] === this.seatPrices[selected])
      throw new StripeProviderError("invalid_config");
    for (const id of [this.workspacePrices[selected], this.seatPrices[selected]]) {
      const price = await this.retrievePrice(id);
      if (
        !price.active ||
        price.currency !== "eur" ||
        price.type !== "recurring" ||
        price.unit_amount === null ||
        price.recurring?.interval !== (selected === "monthly" ? "month" : "year") ||
        price.recurring.interval_count !== 1 ||
        price.recurring.usage_type !== "licensed"
      )
        throw new StripeProviderError("invalid_config");
    }
  }

  async listSubscriptions(customerId: string, cursor?: string) {
    const parameters = this.listParams(customerId, cursor, subscriptionIdSchema);
    parameters.set("limit", "100");
    parameters.set("status", "all");
    const result = await this.request(
      "GET",
      "/subscriptions",
      stripePageSchema(stripeSubscriptionSchema),
      parameters,
    );
    for (const subscription of result.data) {
      this.assertSubscription(subscription);
      if (subscription.customer !== customerId) throw new StripeProviderError("invalid_response");
    }
    return this.page(result);
  }

  async retrieveSubscription(id: string) {
    const subscription = input(subscriptionIdSchema, id);
    const result = await this.request(
      "GET",
      `/subscriptions/${subscription}`,
      stripeSubscriptionSchema,
    );
    this.assertSubscription(result);
    if (result.id !== subscription) throw new StripeProviderError("invalid_response");
    return result;
  }

  #seatParameters(
    interval: BillingInterval,
    totalSeats: number,
    seatItemId: string | null,
    prefix: string,
  ) {
    input(billingIntervalSchema, interval);
    input(z.number().int().min(1).max(10_000), totalSeats);
    if (seatItemId !== null) input(stripeIdSchema("si"), seatItemId);
    const parameters = new URLSearchParams();
    const quantity = Math.max(0, totalSeats - this.includedSeats);
    if (seatItemId !== null) parameters.set(`${prefix}[0][id]`, seatItemId);
    else if (quantity > 0) parameters.set(`${prefix}[0][price]`, this.seatPrices[interval]);
    if (seatItemId !== null && quantity === 0) parameters.set(`${prefix}[0][deleted]`, "true");
    else if (quantity > 0) parameters.set(`${prefix}[0][quantity]`, String(quantity));
    return parameters;
  }

  async previewSeats(
    subscriptionId: string,
    interval: BillingInterval,
    totalSeats: number,
    seatItemId: string | null,
    prorationDate: number,
  ) {
    const id = input(subscriptionIdSchema, subscriptionId);
    input(z.number().int().positive(), prorationDate);
    const parameters = this.#seatParameters(
      interval,
      totalSeats,
      seatItemId,
      "subscription_details[items]",
    );
    parameters.set("subscription", id);
    parameters.set("subscription_details[proration_date]", String(prorationDate));
    parameters.set("subscription_details[proration_behavior]", "always_invoice");
    return this.request(
      "POST",
      "/invoices/create_preview",
      z.object({
        amount_due: z.number().int().safe(),
        currency: z.literal("eur"),
        total: z.number().int().safe(),
      }),
      parameters,
      randomUUID(),
    );
  }

  async changeSeats(
    subscriptionId: string,
    interval: BillingInterval,
    totalSeats: number,
    seatItemId: string | null,
    prorationDate: number,
    idempotencyKey: string,
  ) {
    const id = input(subscriptionIdSchema, subscriptionId);
    input(z.number().int().positive(), prorationDate);
    const parameters = this.#seatParameters(interval, totalSeats, seatItemId, "items");
    parameters.set("proration_date", String(prorationDate));
    parameters.set("proration_behavior", "always_invoice");
    parameters.set("payment_behavior", "pending_if_incomplete");
    const result = await this.request(
      "POST",
      `/subscriptions/${id}`,
      stripeSubscriptionSchema,
      parameters,
      idempotencyKey,
    );
    this.assertSubscription(result);
    if (result.id !== id) throw new StripeProviderError("invalid_response");
    return result;
  }
}
