// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { settingsMessagesForLocale } from "@/features/identity/settingsMessages";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));

const { updateCompanyGeneralAction, refresh } = vi.hoisted(() => ({
  refresh: vi.fn(),
  updateCompanyGeneralAction: vi.fn(
    (): Promise<{ ok: true } | { ok: false; error: { id: string } }> =>
      Promise.resolve({ ok: true }),
  ),
}));
vi.mock("@/features/settings/actions", () => ({ updateCompanyGeneralAction }));

import { CompanyGeneralClient } from "./CompanyGeneralClient";

beforeEach(() => {
  updateCompanyGeneralAction.mockReset().mockResolvedValue({ ok: true });
  refresh.mockReset();
});

type SaveResult = { ok: true } | { ok: false; error: { id: string } };

function deferred() {
  let settle!: (result: SaveResult) => void;
  const promise = new Promise<SaveResult>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

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

  it.each(["returned", "rejected"] as const)(
    "retries an unchanged draft after a %s failure and waits for acknowledgement",
    async (failure) => {
      if (failure === "returned") {
        updateCompanyGeneralAction.mockResolvedValueOnce({
          ok: false,
          error: { id: "E_PERM_001" },
        });
      } else {
        updateCompanyGeneralAction.mockRejectedValueOnce(new Error("offline"));
      }
      render(<CompanyGeneralClient companyName="Acme" baseCurrency="EUR" />);
      const input = screen.getByLabelText("Company name");
      const draft = " Acme Europe ";
      fireEvent.change(input, { target: { value: draft } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        settingsMessagesForLocale("en")._errors.generic,
      );
      expect(input).toHaveValue(draft);
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(refresh).not.toHaveBeenCalled();

      const retry = deferred();
      updateCompanyGeneralAction.mockReturnValueOnce(retry.promise);
      const save = screen.getByRole("button", { name: "Save" });
      fireEvent.click(save);
      expect(input).toHaveValue(draft);
      expect(input).toHaveAttribute("aria-invalid", "false");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
      expect(updateCompanyGeneralAction).toHaveBeenCalledTimes(2);
      expect(updateCompanyGeneralAction).toHaveBeenNthCalledWith(
        1,
        { companyName: "Acme Europe" },
        "csrf",
      );
      expect(updateCompanyGeneralAction).toHaveBeenNthCalledWith(
        2,
        { companyName: "Acme Europe" },
        "csrf",
      );
      expect(refresh).not.toHaveBeenCalled();

      await act(async () => {
        retry.settle({ ok: true });
        await retry.promise;
      });
      expect(screen.getByRole("status")).toHaveTextContent("Saved");
      expect(input).toHaveValue(draft);
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(refresh).toHaveBeenCalledTimes(1);
      fireEvent.click(save);
      expect(updateCompanyGeneralAction).toHaveBeenCalledTimes(2);
    },
  );

  it("keeps acknowledged success and the unchanged guard when refreshing throws", async () => {
    refresh.mockImplementationOnce(() => {
      throw new Error("refresh interrupted");
    });
    render(<CompanyGeneralClient companyName="Acme" baseCurrency="EUR" />);
    const input = screen.getByLabelText("Company name");
    fireEvent.change(input, { target: { value: "Acme Europe" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Saved");
    expect(input).toHaveValue("Acme Europe");
    expect(input).toHaveAttribute("aria-invalid", "false");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(updateCompanyGeneralAction).toHaveBeenCalledTimes(1);
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
