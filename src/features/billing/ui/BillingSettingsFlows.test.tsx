// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import type * as BillingApi from "./api";
import { BillingSettingsClient } from "./BillingSettingsClient";

const navigation = vi.hoisted(() => ({ stripe: vi.fn(), document: vi.fn() }));
vi.mock("./api", async (original) => ({
  ...(await original<typeof BillingApi>()),
  navigateToStripe: navigation.stripe,
  navigateToBillingDocument: navigation.document,
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
const customer = {
  name: "Synthetic GmbH",
  email: "billing@example.test",
  defaultPaymentMethodId: "pm_card",
  address: {
    line1: "Testweg 1",
    line2: null,
    city: "Berlin",
    state: null,
    postal_code: "10115",
    country: "DE",
  },
};
const overview = {
  configured: true,
  customer,
  subscription: {
    subscriptionId: "sub_synthetic",
    status: "active",
    interval: "monthly",
    purchasedSeats: 5,
    cancelAtPeriodEnd: false,
    currentPeriodEnd: 2_000_000_000,
    latestInvoiceId: "in_owned",
  },
  syncedAt: "2026-11-05T12:00:00Z",
  syncState: "current",
  activeUsers: 2,
  includedSeats: 2,
  currency: "eur",
  livemode: false,
  paymentMethodsManagedBy: "stripe_customer_portal",
};
const page = (data: unknown[]) => ({ data, has_more: false, next_cursor: null });
const envelope = (data: unknown) => Response.json({ ok: true, data });
const commandSchema = z.object({
  action: z.string(),
  quote: z.string().optional(),
  requestId: z.string().optional(),
});

function requestUrl(value: Parameters<typeof fetch>[0]): string {
  if (typeof value === "string") return value;
  return value instanceof URL ? value.href : value.url;
}

it("requires an explicit seat confirmation and retains the exact command after an unknown result", async () => {
  const writes: string[] = [];
  vi.stubGlobal("crypto", { randomUUID: () => "11111111-1111-4111-8111-111111111111" });
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>((url, init) =>
      Promise.resolve(
        (() => {
          if (init?.method === "POST") {
            const body = typeof init.body === "string" ? init.body : "";
            writes.push(body);
            const command = commandSchema.parse(JSON.parse(body));
            if (command.action === "preview_seats")
              return envelope({
                quote: "unchanged-signed-quote",
                amountDue: 500,
                currency: "eur",
                expiresAt: 2_000_000_000,
                purchasedSeats: 7,
                isEstimate: true,
              });
            return Response.json(
              { ok: false, error: { code: "provider_unavailable" } },
              { status: 503 },
            );
          }
          return envelope(requestUrl(url).endsWith("/overview") ? overview : page([]));
        })(),
      ),
    ),
  );
  render(<BillingSettingsClient enabled includedSeats={2} allowedCountries={["DE"]} />);
  const user = userEvent.setup();
  const seats = await screen.findByLabelText("Total seats");
  await user.clear(seats);
  await user.type(seats, "7");
  await user.click(screen.getByRole("button", { name: "Review seat change" }));
  await screen.findByRole("button", { name: "Confirm seat change" });
  expect(writes).toHaveLength(1);
  expect(commandSchema.parse(JSON.parse(writes[0]!)).action).toBe("preview_seats");
  await user.click(screen.getByRole("button", { name: "Confirm seat change" }));
  await screen.findByRole("alert");
  expect(seats).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Confirm seat change" }));
  await waitFor(() => expect(writes).toHaveLength(3));
  expect(writes[2]).toBe(writes[1]);
  expect(commandSchema.parse(JSON.parse(writes[1]!))).toEqual({
    action: "change_seats",
    quote: "unchanged-signed-quote",
    requestId: "11111111-1111-4111-8111-111111111111",
  });
});

it("shows masked methods, owned document actions and an existing checkout continuation", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>((url) =>
      Promise.resolve(
        (() => {
          const path = requestUrl(url);
          if (path.endsWith("/overview"))
            return envelope({
              ...overview,
              subscription: null,
              pendingCheckout: {
                id: "cs_resume",
                status: "open",
                url: "https://checkout.stripe.com/c/resume",
                expiresAt: 2_000_000_000,
              },
            });
          if (path.endsWith("/payment-methods"))
            return envelope(
              page([
                {
                  id: "pm_card",
                  type: "card",
                  card: {
                    brand: "visa",
                    last4: "4242",
                    exp_month: 12,
                    exp_year: 2030,
                  },
                },
              ]),
            );
          if (path.endsWith("/invoices"))
            return envelope(
              page([
                {
                  id: "in_owned",
                  number: "INV-1",
                  status: "paid",
                  currency: "eur",
                  amount_due: 1200,
                  total: 1200,
                  created: 1_900_000_000,
                  invoice_pdf: "https://pay.stripe.com/invoice/owned.pdf",
                  hosted_invoice_url: "https://invoice.stripe.com/i/owned",
                },
              ]),
            );
          return envelope(
            page([
              {
                id: "ch_owned",
                amount: 1200,
                currency: "eur",
                created: 1_900_000_000,
                paid: true,
                refunded: false,
                status: "succeeded",
                receipt_number: "R-1",
              },
            ]),
          );
        })(),
      ),
    ),
  );
  render(<BillingSettingsClient enabled includedSeats={2} allowedCountries={["DE"]} />);
  const user = userEvent.setup();
  const invoice = await screen.findByRole("button", { name: "Download invoice" });
  expect(screen.getByText("•••• 4242")).toBeInTheDocument();
  expect(screen.getByText("Customer default")).toBeInTheDocument();
  expect(invoice.closest("table")?.closest(".ph-no-capture")).not.toBeNull();
  await user.click(invoice);
  expect(navigation.document).toHaveBeenCalledWith("invoices", "in_owned", expect.any(AbortSignal));
  await user.click(screen.getByRole("button", { name: "Open receipt" }));
  expect(navigation.document).toHaveBeenCalledWith("receipts", "ch_owned", expect.any(AbortSignal));
  await user.click(screen.getByRole("button", { name: "Continue checkout" }));
  expect(navigation.stripe).toHaveBeenCalledWith("https://checkout.stripe.com/c/resume");
});
