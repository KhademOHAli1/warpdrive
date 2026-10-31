// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { InvitationScreen } from "./InvitationScreen";

const { workflowRequest, signUpEmail, replace } = vi.hoisted(() => ({
  workflowRequest: vi.fn(),
  signUpEmail: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("./workflowRequest", () => ({ workflowRequest, invitationSchema: {} }));
vi.mock("./useAccountStatus", () => ({
  useAuthProviders: () => ({
    config: { providers: [], emailPassword: true, passkeys: true },
    error: false,
  }),
}));
vi.mock("../better/client", () => ({ authClient: { signUp: { email: signUpEmail } } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("prevents account creation when the invitation is invalid", async () => {
  workflowRequest.mockResolvedValue({ ok: false, error: "INVITATION_EXPIRED" });
  render(
    <LocaleProvider locale="de">
      <InvitationScreen token="expired" />
    </LocaleProvider>,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("Diese Einladung ist ungültig");
  expect(screen.queryByRole("button", { name: "Konto einrichten" })).toBeNull();
  expect(signUpEmail).not.toHaveBeenCalled();
});
it("locks the invited recipient and completes the Persian account setup", async () => {
  workflowRequest.mockResolvedValue({
    ok: true,
    data: { email: "invited@example.com", name: "Ali", expiresAt: "2026-11-01T00:00:00Z" },
  });
  signUpEmail.mockResolvedValue({ data: {}, error: null });
  render(
    <LocaleProvider locale="fa">
      <InvitationScreen token="valid" />
    </LocaleProvider>,
  );
  expect(await screen.findByDisplayValue("invited@example.com")).toHaveAttribute("readonly");
  fireEvent.change(screen.getByLabelText("گذرواژه جدید"), {
    target: { value: "a long private passphrase" },
  });
  fireEvent.change(screen.getByLabelText("تکرار گذرواژه"), {
    target: { value: "a long private passphrase" },
  });
  fireEvent.click(screen.getByRole("button", { name: "ساخت حساب" }));
  await waitFor(() =>
    expect(signUpEmail).toHaveBeenCalledWith(
      expect.objectContaining({ email: "invited@example.com", name: "Ali" }),
    ),
  );
  expect(replace).toHaveBeenCalledWith("/auth/verify-email");
});
