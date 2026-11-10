import { describe, expect, it, vi } from "vitest";
import { type BillingHttpDependencies, createBillingHttp } from "./http";

describe("billing HTTP boundary", () => {
  it("does not construct billing services before authorization", async () => {
    const service = vi.fn();
    const api = createBillingHttp({
      service,
      authorized: () => Promise.resolve(Response.json({ ok: false }, { status: 403 })),
    });
    const response = await api.GET(new Request("https://app.example.com/api/billing/invoices"), [
      "invoices",
    ]);
    expect(response.status).toBe(403);
    expect(service).not.toHaveBeenCalled();
  });
  it("requires mutation authority and rejects browser supplied customer or price IDs", async () => {
    const authority = vi.fn<BillingHttpDependencies["authorized"]>((_r, mutate, _signal, run) => {
      expect(mutate).toBe(true);
      return run({ id: "admin", authorize: () => Promise.resolve() });
    });
    const service = vi.fn();
    const api = createBillingHttp({ service, authorized: authority });
    const response = await api.POST(
      new Request("https://app.example.com/api/billing", {
        method: "POST",
        body: JSON.stringify({ action: "portal", intent: "overview", customerId: "cus_other" }),
      }),
    );
    expect(response.status).toBe(400);
    expect(service).not.toHaveBeenCalled();
  });
  it("returns no-store on authorized billing responses", async () => {
    const api = createBillingHttp({
      service: () => ({ overview: () => Promise.resolve({ configured: true }) }) as never,
      authorized: async (_r, _m, _s, run) =>
        run({ id: "admin", authorize: () => Promise.resolve() }),
    });
    const response = await api.GET(new Request("https://app.example.com/api/billing"), []);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
});
