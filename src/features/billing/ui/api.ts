"use client";

import { z } from "zod";
import { readCsrfToken } from "@/utils/csrfCookie";
import {
  type BillingCommand,
  type BillingErrorCode,
  type BillingInvoice,
  type BillingOverview,
  type BillingPage,
  type BillingPageKind,
  type BillingPaymentMethod,
  type BillingReceipt,
  billingErrorCodeSchema,
  chargeIdSchema,
  errorEnvelope,
  invoiceIdSchema,
  invoiceSchema,
  overviewSchema,
  pageSchema,
  paymentMethodSchema,
  receiptSchema,
  stripeHostedUrlSchema,
} from "./apiSchemas";

export type {
  BillingCheckout,
  BillingCommand,
  BillingErrorCode,
  BillingInvoice,
  BillingOverview,
  BillingPage,
  BillingPageKind,
  BillingPaymentMethod,
  BillingProfile,
  BillingReceipt,
  BillingSeatPreview,
  BillingSubscription,
} from "./apiSchemas";
export { billingResponseSchemas } from "./apiSchemas";

export class BillingApiError extends Error {
  constructor(
    readonly code: BillingErrorCode,
    readonly id?: string,
  ) {
    super(`Billing request failed (${code}).`);
    this.name = "BillingApiError";
  }
}

function knownErrorCode(code: string): BillingErrorCode {
  const parsed = billingErrorCodeSchema.safeParse(code);
  return parsed.success ? parsed.data : "provider_unavailable";
}

async function readResponse(response: Response, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted();
  try {
    return await response.json();
  } catch {
    throw new BillingApiError("provider_unavailable");
  }
}

async function request<T extends z.ZodType>(
  url: string,
  schema: T,
  signal: AbortSignal,
  init?: RequestInit,
): Promise<z.output<T>> {
  const response = await fetch(url, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  const body = await readResponse(response, signal);
  const failure = errorEnvelope.safeParse(body);
  if (failure.success) {
    throw new BillingApiError(knownErrorCode(failure.data.error.code), failure.data.error.id);
  }
  const success = z.object({ ok: z.literal(true), data: z.unknown() }).safeParse(body);
  if (!success.success || !response.ok) throw new BillingApiError("provider_unavailable");
  const parsed = schema.safeParse(success.data.data);
  if (!parsed.success) throw new BillingApiError("provider_unavailable");
  return parsed.data;
}

export function getBillingOverview(signal: AbortSignal): Promise<BillingOverview> {
  return request("/api/billing/overview", overviewSchema, signal);
}

async function pageRequest<T extends z.ZodType>(
  kind: BillingPageKind,
  schema: T,
  cursor: string | null,
  signal: AbortSignal,
): Promise<BillingPage<z.output<T>>> {
  const url =
    cursor === null
      ? `/api/billing/${kind}`
      : `/api/billing/${kind}?cursor=${encodeURIComponent(cursor)}`;
  const page = await request(url, pageSchema(schema), signal);
  return { data: page.data, hasMore: page.has_more, nextCursor: page.next_cursor };
}

export function getBillingPage(
  kind: "invoices",
  cursor: string | null,
  signal: AbortSignal,
): Promise<BillingPage<BillingInvoice>>;
export function getBillingPage(
  kind: "receipts",
  cursor: string | null,
  signal: AbortSignal,
): Promise<BillingPage<BillingReceipt>>;
export function getBillingPage(
  kind: "payment-methods",
  cursor: string | null,
  signal: AbortSignal,
): Promise<BillingPage<BillingPaymentMethod>>;
export function getBillingPage(
  kind: BillingPageKind,
  cursor: string | null,
  signal: AbortSignal,
): Promise<BillingPage<BillingInvoice | BillingReceipt | BillingPaymentMethod>> {
  if (kind === "invoices") return pageRequest(kind, invoiceSchema, cursor, signal);
  if (kind === "receipts") return pageRequest(kind, receiptSchema, cursor, signal);
  return pageRequest(kind, paymentMethodSchema, cursor, signal);
}

export function postBilling<T extends z.ZodType>(
  command: BillingCommand,
  schema: T,
  signal: AbortSignal,
): Promise<z.output<T>> {
  return request("/api/billing", schema, signal, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-csrf-token": readCsrfToken() ?? "",
    },
    body: JSON.stringify(command),
  });
}

export function navigateToBillingDocument(
  kind: "invoices" | "receipts",
  id: string,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const parsed = (kind === "invoices" ? invoiceIdSchema : chargeIdSchema).safeParse(id);
  if (!parsed.success) throw new BillingApiError("invalid_input");
  window.location.assign(`/api/billing/${kind}/${encodeURIComponent(parsed.data)}/download`);
  return Promise.resolve();
}

export function navigateToStripe(url: string): void {
  const parsed = stripeHostedUrlSchema.safeParse(url);
  if (!parsed.success) throw new BillingApiError("provider_unavailable");
  window.location.assign(parsed.data);
}
