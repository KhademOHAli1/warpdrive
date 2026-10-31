// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { LoginScreen } from "../LoginScreen";

const { signInEmail, replace } = vi.hoisted(() => ({
  signInEmail: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh: vi.fn() }) }));
vi.mock("../better/client", () => ({
  authClient: {
    signIn: { email: signInEmail, social: vi.fn(), passkey: vi.fn() },
  },
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("connects the Persian password form to authentication and continues into policy checks", async () => {
  signInEmail.mockResolvedValue({ data: { twoFactorRedirect: true }, error: null });
  render(
    <LocaleProvider locale="fa">
      <LoginScreen config={{ emailPassword: true, passkeys: true, providers: [] }} />
    </LocaleProvider>,
  );
  fireEvent.change(screen.getByLabelText("نشانی ایمیل"), { target: { value: "ali@example.com" } });
  fireEvent.change(screen.getByLabelText("گذرواژه"), {
    target: { value: "a long private password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "ورود" }));
  await waitFor(() =>
    expect(signInEmail).toHaveBeenCalledWith(
      expect.objectContaining({ email: "ali@example.com", password: "a long private password" }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ),
  );
  await waitFor(() => expect(replace).toHaveBeenCalledWith("/auth/mfa"));
  expect(screen.getByRole("link", { name: "گذرواژه را فراموش کرده‌اید؟" })).toHaveAttribute(
    "href",
    "/auth/forgot-password",
  );
});

it("keeps credentials editable after a rejected German login and shows a localized safe error", async () => {
  signInEmail.mockResolvedValue({
    data: null,
    error: { code: "INVALID_EMAIL_OR_PASSWORD", message: "private backend details" },
  });
  render(
    <LocaleProvider locale="de">
      <LoginScreen config={{ emailPassword: true, passkeys: false, providers: [] }} />
    </LocaleProvider>,
  );
  fireEvent.change(screen.getByLabelText("E-Mail-Adresse"), {
    target: { value: "ali@example.com" },
  });
  fireEvent.change(screen.getByLabelText("Passwort"), {
    target: { value: "a long private password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Anmelden" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "E-Mail-Adresse oder Passwort stimmen nicht.",
  );
  expect(screen.getByLabelText("E-Mail-Adresse")).toHaveValue("ali@example.com");
  expect(screen.queryByText("private backend details")).toBeNull();
  expect(replace).not.toHaveBeenCalled();
});
