// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { BillingSettingsClient } from "./BillingSettingsClient";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function jsonBody(value: unknown): unknown {
  if (typeof value !== "string") throw new Error("Expected JSON request body");
  return JSON.parse(value);
}

describe("BillingSettingsClient", () => {
  it("explains that billing is disabled without exposing deployment configuration", () => {
    render(<BillingSettingsClient enabled={false} includedSeats={0} allowedCountries={[]} />);

    expect(screen.getByText("Billing isn't enabled for this workspace.")).toBeInTheDocument();
    expect(screen.queryByText(/STRIPE|BILLING_ENABLED|merchant/i)).not.toBeInTheDocument();
  });

  it("keeps the customer profile private and starts with a checkout profile", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        ok: true,
        data: {
          configured: true,
          customer: null,
          subscription: null,
          syncedAt: null,
          syncState: "never",
          activeUsers: 1,
          includedSeats: 3,
          currency: "eur",
          livemode: false,
          paymentMethodsManagedBy: "stripe_customer_portal",
        },
      }),
    );
    vi.stubGlobal("fetch", fetcher);

    render(<BillingSettingsClient enabled includedSeats={3} allowedCountries={["DE", "FR"]} />);

    await waitFor(() => expect(screen.getByLabelText("Billing name")).toBeInTheDocument());
    expect(screen.getByLabelText("Billing email")).toBeInTheDocument();
    expect(screen.getByLabelText("Country")).toBeInTheDocument();
    expect(screen.getByText("Start subscription")).toBeInTheDocument();
    expect(screen.getByLabelText("Billing name").closest("form")).toHaveClass(
      "ph-no-capture",
      "ph-block-email",
    );
    expect(fetcher).toHaveBeenCalledWith(
      "/api/billing/overview",
      expect.objectContaining({ cache: "no-store", credentials: "same-origin" }),
    );
  });

  it("reuses the checkout request UUID after an uncertain provider response", async () => {
    const overview = Response.json({
      ok: true,
      data: {
        configured: true,
        customer: null,
        subscription: null,
        syncedAt: null,
        syncState: "never",
        activeUsers: 1,
        includedSeats: 1,
        currency: "eur",
        livemode: false,
        paymentMethodsManagedBy: "stripe_customer_portal",
      },
    });
    const unavailable = () =>
      Response.json({ ok: false, error: { code: "provider_unavailable" } }, { status: 503 });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(overview);
    fetcher.mockImplementationOnce(() => Promise.resolve(unavailable()));
    fetcher.mockImplementationOnce(() => Promise.resolve(unavailable()));
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("crypto", { randomUUID: () => "11111111-1111-4111-8111-111111111111" });
    vi.spyOn(document, "cookie", "get").mockReturnValue("wd_csrf=csrf-token");

    render(<BillingSettingsClient enabled includedSeats={1} allowedCountries={["DE"]} />);
    await waitFor(() => expect(screen.getByLabelText("Billing name")).toBeInTheDocument());
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Billing name"), "Warpdrive GmbH");
    await user.type(screen.getByLabelText("Billing email"), "billing@example.test");
    await user.type(screen.getByLabelText("Address line 1"), "Main Street 1");
    await user.type(screen.getByLabelText("City"), "Berlin");
    await user.type(screen.getByLabelText("Postal code"), "10115");
    const submit = screen.getByRole("button", { name: "Start subscription" });
    await user.click(submit);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/temporarily unavailable/i),
    );
    expect(screen.getByLabelText("Billing name")).toBeDisabled();
    await user.click(submit);

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    const checkoutCommandSchema = z.object({
      action: z.literal("checkout"),
      requestId: z.string().uuid(),
      interval: z.enum(["monthly", "yearly"]),
      totalSeats: z.number().int(),
      profile: z.object({
        name: z.string(),
        email: z.string(),
        address: z.object({
          line1: z.string(),
          city: z.string(),
          postalCode: z.string(),
          country: z.string(),
        }),
      }),
    });
    const firstBody = checkoutCommandSchema.parse(jsonBody(fetcher.mock.calls[1]?.[1]?.body));
    const secondBody = checkoutCommandSchema.parse(jsonBody(fetcher.mock.calls[2]?.[1]?.body));
    expect(firstBody.requestId).toBe("11111111-1111-4111-8111-111111111111");
    expect(secondBody).toEqual(firstBody);
    expect(fetcher.mock.calls[1]?.[1]?.headers).toMatchObject({ "x-csrf-token": "csrf-token" });
  });
});
