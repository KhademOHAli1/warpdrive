// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { LoginScreen } from "../LoginScreen";
import { LAST_SIGN_IN_METHOD_COOKIE, rememberSignInMethod } from "./signInMethod";

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
  // biome-ignore lint/suspicious/noDocumentCookie: reset the actual non-secret preference between browser-unit cases.
  document.cookie = `${LAST_SIGN_IN_METHOD_COOKIE}=; Path=/; Max-Age=0`;
});

it("prioritizes the previous available method without automatically starting authentication", () => {
  const config = {
    emailPassword: true,
    passkeys: true,
    providers: [{ id: "google", name: "Google" }],
  };
  rememberSignInMethod("google", config);
  render(
    <LocaleProvider locale="en">
      <LoginScreen config={config} />
    </LocaleProvider>,
  );
  const primary = screen.getByRole("button", { name: "Sign in with Google" });
  const password = screen.getByRole("button", { name: "Sign in" });
  expect(primary.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByText("Last used")).toBeInTheDocument();
  expect(signInEmail).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Password")).toBeEnabled();
});

it("ignores the saved provider when it is no longer available", () => {
  rememberSignInMethod("google");
  render(
    <LocaleProvider locale="en">
      <LoginScreen config={{ emailPassword: true, passkeys: false, providers: [] }} />
    </LocaleProvider>,
  );
  expect(screen.queryByText("Last used")).toBeNull();
  expect(screen.queryByRole("button", { name: "Sign in with Google" })).toBeNull();
  expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
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
  expect(screen.getByRole("link", { name: "برای ورود به مشکل خورده‌اید؟" })).toHaveAttribute(
    "href",
    "/auth/help",
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
