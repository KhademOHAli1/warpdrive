import { randomUUID } from "node:crypto";
import { z } from "zod";
import { StripeDocumentGateway } from "./documents";
import { StripeProviderError } from "./errors";
import {
  accountIdSchema,
  type BillingInterval,
  billingIntervalSchema,
  checkoutIdSchema,
  customerIdSchema,
  type PortalIntent,
  type StripeCustomerProfile,
  stripeCheckoutSchema,
  stripeCustomerProfileSchema,
  stripeCustomerSchema,
  stripePageSchema,
  stripePortalSchema,
  subscriptionIdSchema,
} from "./schemas";

export type { StripeBillingConfig } from "./transport";

function input<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new StripeProviderError("invalid_input");
  return parsed.data;
}

export class StripeGateway extends StripeDocumentGateway {
  async createCustomer(accountId: string, profile: StripeCustomerProfile, idempotencyKey: string) {
    const account = input(accountIdSchema, accountId);
    const customer = input(stripeCustomerProfileSchema, profile);
    const parameters = new URLSearchParams({
      name: customer.name,
      email: customer.email,
      "address[line1]": customer.address.line1,
      "address[city]": customer.address.city,
      "address[postal_code]": customer.address.postalCode,
      "address[country]": customer.address.country,
      "metadata[warpdrive_account_id]": account,
    });
    if (customer.address.line2 !== undefined && customer.address.line2 !== "")
      parameters.set("address[line2]", customer.address.line2);
    if (customer.address.state !== undefined && customer.address.state !== "")
      parameters.set("address[state]", customer.address.state);
    if (customer.taxId) {
      parameters.set("tax_id_data[0][type]", customer.taxId.type);
      parameters.set("tax_id_data[0][value]", customer.taxId.value);
    }
    const result = await this.request(
      "POST",
      "/customers",
      stripeCustomerSchema,
      parameters,
      idempotencyKey,
    );
    this.assertMode(result);
    if (result.metadata.warpdrive_account_id !== account)
      throw new StripeProviderError("invalid_response");
    return result;
  }

  async retrieveCustomer(id: string) {
    const customerId = input(customerIdSchema, id);
    const result = await this.request(
      "GET",
      `/customers/${customerId}`,
      stripeCustomerSchema,
      new URLSearchParams({ "expand[]": "tax_ids" }),
    );
    this.assertMode(result);
    if (result.id !== customerId) throw new StripeProviderError("invalid_response");
    return result;
  }

  async searchCustomers(accountId: string) {
    const account = input(accountIdSchema, accountId);
    const result = await this.request(
      "GET",
      "/customers/search",
      z.object({
        object: z.literal("search_result"),
        data: z.array(stripeCustomerSchema),
        has_more: z.boolean(),
      }),
      new URLSearchParams({ query: `metadata['warpdrive_account_id']:'${account}'`, limit: "100" }),
    );
    if (result.has_more || result.data.length > 1)
      throw new StripeProviderError("invalid_response");
    for (const customer of result.data) {
      this.assertMode(customer);
      if (customer.metadata.warpdrive_account_id !== account)
        throw new StripeProviderError("invalid_response");
    }
    return result.data;
  }

  async createCheckout(
    customerId: string,
    accountId: string,
    interval: BillingInterval,
    totalSeats: number,
    idempotencyKey: string,
  ) {
    const customer = input(customerIdSchema, customerId);
    const account = input(accountIdSchema, accountId);
    const selectedInterval = input(billingIntervalSchema, interval);
    const seats = input(z.number().int().min(1).max(10_000), totalSeats);
    const parameters = new URLSearchParams({
      customer,
      mode: "subscription",
      client_reference_id: account,
      "metadata[warpdrive_account_id]": account,
      "metadata[warpdrive_operation_key]": idempotencyKey,
      "subscription_data[metadata][warpdrive_account_id]": account,
      "line_items[0][price]": this.workspacePrices[selectedInterval],
      "line_items[0][quantity]": "1",
      "automatic_tax[enabled]": String(this.automaticTax),
      billing_address_collection: "required",
      "tax_id_collection[enabled]": "true",
      "customer_update[address]": "auto",
      "customer_update[name]": "auto",
      success_url: `${this.appOrigin}/settings/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${this.appOrigin}/settings/billing?checkout=canceled`,
    });
    const paidSeats = Math.max(0, seats - this.includedSeats);
    if (paidSeats > 0) {
      parameters.set("line_items[1][price]", this.seatPrices[selectedInterval]);
      parameters.set("line_items[1][quantity]", String(paidSeats));
    }
    const result = await this.request(
      "POST",
      "/checkout/sessions",
      stripeCheckoutSchema,
      parameters,
      idempotencyKey,
    );
    this.assertMode(result);
    if (
      result.customer !== customer ||
      result.mode !== "subscription" ||
      result.client_reference_id !== account ||
      result.metadata.warpdrive_account_id !== account
    ) {
      throw new StripeProviderError("invalid_response");
    }
    return result;
  }

  async listCheckouts(customerId: string, cursor?: string) {
    const result = await this.request(
      "GET",
      "/checkout/sessions",
      stripePageSchema(stripeCheckoutSchema),
      this.listParams(customerId, cursor, checkoutIdSchema),
    );
    for (const checkout of result.data) {
      this.assertMode(checkout);
      if (checkout.customer !== customerId) throw new StripeProviderError("invalid_response");
    }
    return this.page(result);
  }

  async retrieveCheckout(id: string) {
    const checkout = input(checkoutIdSchema, id);
    const result = await this.request(
      "GET",
      `/checkout/sessions/${checkout}`,
      stripeCheckoutSchema,
    );
    this.assertMode(result);
    if (result.id !== checkout) throw new StripeProviderError("invalid_response");
    return result;
  }

  async createPortal(
    customerId: string,
    intent: PortalIntent,
    subscriptionId?: string,
    idempotencyKey = randomUUID(),
  ) {
    const customer = input(customerIdSchema, customerId);
    input(z.enum(["overview", "payment_methods", "cancel"]), intent);
    const returnUrl = `${this.appOrigin}/settings/billing`;
    const parameters = new URLSearchParams({
      customer,
      configuration: this.portalConfigurationId,
      return_url: returnUrl,
    });
    if (intent === "payment_methods") {
      parameters.set("flow_data[type]", "payment_method_update");
      parameters.set("flow_data[after_completion][type]", "portal_homepage");
    }
    if (intent === "cancel") {
      parameters.set("flow_data[type]", "subscription_cancel");
      parameters.set(
        "flow_data[subscription_cancel][subscription]",
        input(subscriptionIdSchema, subscriptionId),
      );
      parameters.set("flow_data[after_completion][type]", "redirect");
      parameters.set("flow_data[after_completion][redirect][return_url]", returnUrl);
    }
    const result = await this.request(
      "POST",
      "/billing_portal/sessions",
      stripePortalSchema,
      parameters,
      idempotencyKey,
    );
    this.assertMode(result);
    if (result.customer !== customer) throw new StripeProviderError("invalid_response");
    return result;
  }
}
