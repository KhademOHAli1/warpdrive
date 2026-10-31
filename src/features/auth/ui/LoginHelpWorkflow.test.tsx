// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import { authScreensMessagesForLocale } from "../authScreensMessages";
import { LoginScreen } from "../LoginScreen";

const { emailSignIn, passkeySignIn, replace } = vi.hoisted(() => ({
  emailSignIn: vi.fn(),
  passkeySignIn: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("../better/client", () => ({
  authClient: { signIn: { email: emailSignIn, passkey: passkeySignIn, social: vi.fn() } },
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const helpLabels = {
  fa: "برای ورود به مشکل خورده‌اید؟",
  de: "Probleme beim Anmelden?",
  en: "Trouble signing in?",
};
const invalidPassword = { data: null, error: { code: "INVALID_EMAIL_OR_PASSWORD" } };

function showLogin(locale: Locale, passwords = true) {
  render(
    <LocaleProvider locale={locale}>
      <LoginScreen
        config={{ emailPassword: passwords, passkeys: true, providers: [] }}
        returnTo="/activities/calendar?view=month"
      />
    </LocaleProvider>,
  );
  return authScreensMessagesForLocale(locale).flow;
}

function fillCredentials(L: ReturnType<typeof showLogin>) {
  fireEvent.change(screen.getByLabelText(L.email), { target: { value: "ali@example.com" } });
  fireEvent.change(screen.getByLabelText(L.password), {
    target: { value: "a private passphrase" },
  });
}

async function attemptPassword(L: ReturnType<typeof showLogin>) {
  fireEvent.click(screen.getByRole("button", { name: L.signIn }));
  await waitFor(() => expect(screen.getByRole("button", { name: L.signIn })).toBeEnabled());
}

describe.each(["fa", "de", "en"] as const)("%s login help", (locale) => {
  it("starts with one help link and groups password and passkey actions together", () => {
    const L = showLogin(locale);
    const help = screen.getByRole("link", { name: helpLabels[locale] });
    expect(help).toHaveAttribute(
      "href",
      "/auth/help?returnTo=%2Factivities%2Fcalendar%3Fview%3Dmonth",
    );
    expect(screen.queryByRole("link", { name: L.forgotPassword })).toBeNull();
    expect(screen.queryByRole("link", { name: L.accountRecovery })).toBeNull();
    expect(screen.queryByRole("link", { name: L.resetTitle })).toBeNull();
    const actions = screen.getByRole("group");
    expect(actions).toHaveAccessibleName();
    expect(within(actions).getByRole("button", { name: L.signIn })).toHaveAttribute(
      "type",
      "submit",
    );
    expect(within(actions).getByRole("button", { name: L.signInWithPasskey })).toHaveAttribute(
      "type",
      "button",
    );
  });

  it("offers a reset only after the second rejected password and resets the hint for another email", async () => {
    emailSignIn.mockResolvedValue(invalidPassword);
    const L = showLogin(locale);
    fillCredentials(L);
    await attemptPassword(L);
    expect(screen.queryByRole("link", { name: L.resetTitle })).toBeNull();
    await attemptPassword(L);
    expect(screen.getByRole("link", { name: L.resetTitle })).toHaveAttribute(
      "href",
      "/auth/forgot-password",
    );
    expect(screen.getByRole("status")).toHaveTextContent(/\S/);
    expect(screen.getByRole("link", { name: helpLabels[locale] })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(L.email), { target: { value: "other@example.com" } });
    expect(screen.queryByRole("link", { name: L.resetTitle })).toBeNull();
    await attemptPassword(L);
    expect(screen.queryByRole("link", { name: L.resetTitle })).toBeNull();
  });

  it("does not count a network failure as a rejected password", async () => {
    emailSignIn
      .mockResolvedValueOnce(invalidPassword)
      .mockRejectedValueOnce(new TypeError("synthetic network failure"))
      .mockResolvedValueOnce(invalidPassword);
    const L = showLogin(locale);
    fillCredentials(L);
    await attemptPassword(L);
    await attemptPassword(L);
    expect(screen.getByRole("alert")).toHaveTextContent(L.networkError);
    expect(screen.queryByRole("link", { name: L.resetTitle })).toBeNull();
    await attemptPassword(L);
    expect(screen.getByRole("link", { name: L.resetTitle })).toBeInTheDocument();
  });

  it("uses a passkey with empty password fields and preserves the safe destination", async () => {
    passkeySignIn.mockResolvedValue({ data: {}, error: null });
    const L = showLogin(locale);
    fireEvent.click(screen.getByRole("button", { name: L.signInWithPasskey }));
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(
        "/auth/continue?returnTo=%2Factivities%2Fcalendar%3Fview%3Dmonth",
      ),
    );
    expect(passkeySignIn).toHaveBeenCalledOnce();
    expect(emailSignIn).not.toHaveBeenCalled();
  });
});

it("does not count cancelled passkeys or rate-limited password attempts toward the reset hint", async () => {
  passkeySignIn.mockResolvedValue({ error: { code: "PASSKEY_CANCELLED" }, data: null });
  emailSignIn.mockResolvedValue({ error: { code: "TOO_MANY_REQUESTS" }, data: null });
  const L = showLogin("en");
  for (let index = 0; index < 2; index++) {
    fireEvent.click(screen.getByRole("button", { name: L.signInWithPasskey }));
    await waitFor(() => expect(screen.getByRole("button", { name: L.signIn })).toBeEnabled());
  }
  fillCredentials(L);
  await attemptPassword(L);
  await attemptPassword(L);
  expect(screen.queryByRole("link", { name: L.resetTitle })).toBeNull();
  emailSignIn.mockResolvedValue(invalidPassword);
  await attemptPassword(L);
  expect(screen.queryByRole("link", { name: L.resetTitle })).toBeNull();
});

it("still offers passkey-only sign-in without password fields", async () => {
  passkeySignIn.mockResolvedValue({ data: {}, error: null });
  const L = showLogin("de", false);
  expect(screen.queryByLabelText(L.email)).toBeNull();
  expect(screen.queryByLabelText(L.password)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: L.signInWithPasskey }));
  await waitFor(() => expect(passkeySignIn).toHaveBeenCalledOnce());
  expect(screen.getByRole("link", { name: helpLabels.de })).toBeInTheDocument();
});
