import { describe, expect, it, vi } from "vitest";
import { ownedDocumentUrl } from "./documents";
import { boundedBody } from "./http";
import { stripeConfig, stripeJson } from "./stripe/fixtures.test-support";
import { StripeGateway } from "./stripe/gateway";

const invoice = {
  id: "in_example",
  object: "invoice",
  livemode: false,
  customer: "cus_example",
  number: "S-1",
  status: "paid",
  currency: "eur",
  amount_due: 100,
  amount_paid: 100,
  amount_remaining: 0,
  total: 100,
  created: 1_999_000_000,
  due_date: null,
  period_start: 1_999_000_000,
  period_end: 2_000_000_000,
  hosted_invoice_url: "https://invoice.stripe.com/i/example",
  invoice_pdf: "https://pay.stripe.com/invoice/example/pdf",
};
describe("billing document access", () => {
  it("returns the canonical finalized PDF for the bound customer", async () => {
    const stripe = new StripeGateway(stripeConfig(() => stripeJson(invoice)));
    expect(await ownedDocumentUrl(stripe, "cus_example", "invoice", "in_example")).toBe(
      invoice.invoice_pdf,
    );
  });
  it("does not expose another customer's document", async () => {
    const stripe = new StripeGateway(stripeConfig(() => stripeJson(invoice)));
    await expect(
      ownedDocumentUrl(stripe, "cus_other", "invoice", "in_example"),
    ).rejects.toMatchObject({ code: "not_found" });
  });
  it("does not present a draft preview as a downloadable finalized invoice", async () => {
    const stripe = new StripeGateway(
      stripeConfig(() => stripeJson({ ...invoice, status: "draft" })),
    );
    await expect(
      ownedDocumentUrl(stripe, "cus_example", "invoice", "in_example"),
    ).rejects.toMatchObject({ code: "not_ready" });
  });
});
describe("bounded raw billing bodies", () => {
  it("counts UTF-8 bytes rather than characters", async () => {
    const request = new Request("https://app.example.com", { method: "POST", body: "éé" });
    await expect(boundedBody(request, 3, new AbortController().signal)).rejects.toMatchObject({
      code: "invalid_input",
    });
  });
  it("keeps the exact signed raw text", async () => {
    const raw = '{ "a": "é" }\n';
    expect(
      await boundedBody(
        new Request("https://app.example.com", { method: "POST", body: raw }),
        100,
        new AbortController().signal,
      ),
    ).toBe(raw);
  });
  it("cancels a stalled stream when its caller aborts", async () => {
    const canceled = vi.fn();
    const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>({ cancel: canceled });
    const init = { method: "POST", body: stream, duplex: "half" };
    const result = boundedBody(
      new Request("https://app.example.com", init),
      100,
      controller.signal,
    );
    queueMicrotask(() => controller.abort());
    await expect(result).rejects.toThrow();
    expect(canceled).toHaveBeenCalledTimes(1);
  });
});
