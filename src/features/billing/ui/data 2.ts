import {
  BillingApiError,
  type BillingInvoice,
  type BillingOverview,
  type BillingPage,
  type BillingPaymentMethod,
  type BillingReceipt,
  getBillingOverview,
  getBillingPage,
} from "./api";
import type { BillingCountryOption } from "./types";

export type BillingLists = {
  "payment-methods": BillingPage<BillingPaymentMethod>;
  invoices: BillingPage<BillingInvoice>;
  receipts: BillingPage<BillingReceipt>;
};

export const emptyPage = <T>(): BillingPage<T> => ({ data: [], hasMore: false, nextCursor: null });

export async function readBillingData(signal: AbortSignal): Promise<{
  overview: BillingOverview;
  lists: BillingLists;
}> {
  const overview = await getBillingOverview(signal);
  if (overview.customer === null) {
    return {
      overview,
      lists: { "payment-methods": emptyPage(), invoices: emptyPage(), receipts: emptyPage() },
    };
  }
  const [paymentMethods, invoices, receipts] = await Promise.all([
    getBillingPage("payment-methods", null, signal),
    getBillingPage("invoices", null, signal),
    getBillingPage("receipts", null, signal),
  ]);
  return { overview, lists: { "payment-methods": paymentMethods, invoices, receipts } };
}

export function errorCode(error: unknown): string {
  return error instanceof BillingApiError ? error.code : "network";
}

export function countryOptions(codes: string[], locale: string): BillingCountryOption[] {
  const names = new Intl.DisplayNames([locale], { type: "region" });
  return codes.map((code) => ({ value: code, label: names.of(code) ?? code }));
}

export function appendPage<T>(current: BillingPage<T>, next: BillingPage<T>): BillingPage<T> {
  return {
    data: [...current.data, ...next.data],
    hasMore: next.hasMore,
    nextCursor: next.nextCursor,
  };
}

export function uncertainBillingOutcome(code: string): boolean {
  return [
    "network",
    "provider_unavailable",
    "not_ready",
    "checkout_in_progress",
    "reconciliation_required",
    "fresh_auth_required",
  ].includes(code);
}
