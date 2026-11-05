import type { z } from "zod";
import { StripeProviderError } from "./errors";
import {
  chargeIdSchema,
  invoiceIdSchema,
  paymentMethodIdSchema,
  stripeChargeSchema,
  stripeInvoiceSchema,
  stripePageSchema,
  stripePaymentMethodSchema,
} from "./schemas";

import { StripeSubscriptionGateway } from "./subscriptions";

function input<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new StripeProviderError("invalid_input");
  return parsed.data;
}

export class StripeDocumentGateway extends StripeSubscriptionGateway {
  async listInvoices(customerId: string, cursor?: string) {
    const result = await this.request(
      "GET",
      "/invoices",
      stripePageSchema(stripeInvoiceSchema),
      this.listParams(customerId, cursor, invoiceIdSchema),
    );
    for (const invoice of result.data) {
      this.assertMode(invoice);
      if (invoice.customer !== customerId) throw new StripeProviderError("invalid_response");
    }
    return this.page(result);
  }

  async retrieveInvoice(id: string) {
    const invoice = input(invoiceIdSchema, id);
    const result = await this.request("GET", `/invoices/${invoice}`, stripeInvoiceSchema);
    this.assertMode(result);
    if (result.id !== invoice) throw new StripeProviderError("invalid_response");
    return result;
  }

  async listReceipts(customerId: string, cursor?: string) {
    const result = await this.request(
      "GET",
      "/charges",
      stripePageSchema(stripeChargeSchema),
      this.listParams(customerId, cursor, chargeIdSchema),
    );
    for (const charge of result.data) {
      this.assertMode(charge);
      if (charge.customer !== customerId) throw new StripeProviderError("invalid_response");
    }
    const page = this.page(result);
    // Keep the cursor from the original charges page, including filtered-out charges.
    return {
      ...page,
      data: page.data.filter(
        (charge) => charge.paid && charge.status === "succeeded" && charge.receipt_url !== null,
      ),
    };
  }

  async retrieveCharge(id: string) {
    const charge = input(chargeIdSchema, id);
    const result = await this.request("GET", `/charges/${charge}`, stripeChargeSchema);
    this.assertMode(result);
    if (result.id !== charge) throw new StripeProviderError("invalid_response");
    return result;
  }

  async listPaymentMethods(customerId: string, cursor?: string) {
    const result = await this.request(
      "GET",
      "/payment_methods",
      stripePageSchema(stripePaymentMethodSchema),
      this.listParams(customerId, cursor, paymentMethodIdSchema),
    );
    for (const method of result.data) {
      this.assertMode(method);
      if (method.customer !== customerId) throw new StripeProviderError("invalid_response");
    }
    return this.page(result);
  }
}
