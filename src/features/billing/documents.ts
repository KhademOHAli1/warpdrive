import { BillingError } from "./contracts";
import type { StripeGateway } from "./stripe/gateway";
import type { StripeCustomer } from "./stripe/schemas";

export function customerSummary(customer: StripeCustomer | null) {
  if (customer === null) return null;
  return {
    name: customer.name,
    email: customer.email,
    address: customer.address,
    taxIds: customer.tax_ids,
    defaultPaymentMethodId: customer.invoice_settings?.default_payment_method ?? null,
  };
}
export async function ownedDocumentUrl(
  stripe: Pick<StripeGateway, "retrieveInvoice" | "retrieveCharge">,
  customerId: string,
  kind: "invoice" | "receipt",
  id: string,
) {
  if (kind === "invoice") {
    const invoice = await stripe.retrieveInvoice(id);
    if (invoice.customer !== customerId) throw new BillingError("not_found");
    if (invoice.status === "draft" || invoice.invoice_pdf === null)
      throw new BillingError("not_ready");
    return invoice.invoice_pdf;
  }
  const charge = await stripe.retrieveCharge(id);
  if (charge.customer !== customerId) throw new BillingError("not_found");
  if (!charge.paid || charge.status !== "succeeded" || charge.receipt_url === null)
    throw new BillingError("not_ready");
  return charge.receipt_url;
}
