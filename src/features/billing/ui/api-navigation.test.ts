import { afterEach, expect, it, vi } from "vitest";
import { navigateToBillingDocument, navigateToStripe } from "./api";

afterEach(() => vi.unstubAllGlobals());

it("navigates to the authenticated local document route without fetching an opaque redirect", async () => {
  const assign = vi.fn();
  const fetcher = vi.fn<typeof fetch>();
  vi.stubGlobal("window", { location: { assign } });
  vi.stubGlobal("fetch", fetcher);
  await navigateToBillingDocument("invoices", "in_owned", new AbortController().signal);
  expect(assign).toHaveBeenCalledWith("/api/billing/invoices/in_owned/download");
  expect(fetcher).not.toHaveBeenCalled();
  expect(() =>
    navigateToBillingDocument("receipts", "ch_owned/../../foreign", new AbortController().signal),
  ).toThrow();
  expect(assign).toHaveBeenCalledTimes(1);
});

it("rejects unsafe hosted destinations and cancellation before browser navigation", () => {
  const assign = vi.fn();
  vi.stubGlobal("window", { location: { assign } });
  expect(() => navigateToStripe("https://stripe.com.attacker.test/checkout")).toThrow();
  const controller = new AbortController();
  controller.abort();
  expect(() => navigateToBillingDocument("receipts", "ch_owned", controller.signal)).toThrow();
  expect(assign).not.toHaveBeenCalled();
});
