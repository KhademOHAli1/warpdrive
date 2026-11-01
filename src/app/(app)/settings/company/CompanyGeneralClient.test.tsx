// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { settingsMessagesForLocale } from "@/features/identity/settingsMessages";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));

const { updateCompanyGeneralAction } = vi.hoisted(() => ({
  updateCompanyGeneralAction: vi.fn(
    (): Promise<{ ok: true } | { ok: false; error: { id: string } }> =>
      Promise.resolve({ ok: true }),
  ),
}));
vi.mock("@/features/settings/actions", () => ({ updateCompanyGeneralAction }));

import { CompanyGeneralClient } from "./CompanyGeneralClient";

describe("CompanyGeneralClient", () => {
  it("renders the base currency read-only", () => {
    render(<CompanyGeneralClient companyName="Acme" baseCurrency="EUR" />);
    expect(screen.getByText("EUR")).toBeInTheDocument();
    // No editable currency control.
    expect(screen.queryByLabelText("Base currency")).toBeNull();
  });

  it("saves the edited company name via the action", async () => {
    render(<CompanyGeneralClient companyName="Acme" baseCurrency="USD" />);
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Acme Corp" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(updateCompanyGeneralAction).toHaveBeenCalledWith({ companyName: "Acme Corp" }, "csrf"),
    );
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("only offers Save for a changed value and returns to unchanged after success", async () => {
    render(<CompanyGeneralClient companyName="Acme" baseCurrency="EUR" />);
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Acme Europe" } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(await screen.findByRole("status")).toHaveTextContent("Saved");
    expect(save).toBeDisabled();
  });

  it("retains the edited company name and offers retry after a rejected save", async () => {
    updateCompanyGeneralAction.mockResolvedValueOnce({ ok: false, error: { id: "E_PERM_001" } });
    render(<CompanyGeneralClient companyName="Acme" baseCurrency="EUR" />);
    const input = screen.getByLabelText("Company name");
    fireEvent.change(input, { target: { value: "Acme Europe" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      settingsMessagesForLocale("en")._errors.generic,
    );
    expect(input).toHaveValue("Acme Europe");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(screen.queryByText("Saved")).toBeNull();
  });

  it("clears busy state and preserves input after a transport failure", async () => {
    updateCompanyGeneralAction.mockRejectedValueOnce(new Error("offline"));
    render(<CompanyGeneralClient companyName="Acme" baseCurrency="EUR" />);
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Acme Europe" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByLabelText("Company name")).toHaveValue("Acme Europe");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });
});
