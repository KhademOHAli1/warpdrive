// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { authScreensMessagesForLocale } from "../authScreensMessages";
import type { SecurityStatus } from "../better/contracts";
import { SecuritySettings } from "./SecuritySettings";

const { securityAction } = vi.hoisted(() => ({ securityAction: vi.fn() }));
vi.mock("../better/client", () => ({
  authClient: {
    passkey: { addPasskey: securityAction },
    twoFactor: { enable: securityAction },
    linkSocial: securityAction,
  },
}));
vi.mock("./workflowRequest", () => ({ workflowAction: securityAction }));
vi.mock("./useAccountStatus", () => ({
  useAccountStatus: (status: SecurityStatus) => ({ status, error: null, refresh: vi.fn() }),
  useAuthProviders: () => ({ config: { providers: [], emailPassword: true, passkeys: true } }),
}));
vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: vi.fn() }));
vi.mock("@/features/observability/capture", () => ({
  capture: vi.fn(),
  currentRoute: () => "/settings/security",
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.documentElement.removeAttribute("dir");
  document.documentElement.removeAttribute("lang");
});
const status: SecurityStatus = {
  authenticated: true,
  user: { id: "u", name: "Ali", email: "ali@example.com", isAdmin: false },
  emailVerified: true,
  hasPassword: true,
  twoFactorEnabled: false,
  needsMfa: false,
  needsEnrollment: false,
  fresh: true,
  authMethod: "password",
  policy: { requireMfaForAll: false, idleMinutes: 30, absoluteHours: 12, freshMinutes: 5 },
  accounts: [],
  passkeys: [],
  sessions: [],
  recoveryCodesAvailable: false,
  audit: [],
};

it("keeps Farsi credential forms behind an explicit action in an accessible dialog", async () => {
  const L = authScreensMessagesForLocale("fa").flow;
  render(
    <LocaleProvider locale="fa">
      <SecuritySettings initial={status} />
    </LocaleProvider>,
  );
  expect(screen.queryByLabelText("گذرواژه جدید")).toBeNull();
  expect(screen.getByText("ali@example.com")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: `${L.changePassword}: ${L.passwordTitle}` }));
  const dialog = screen.getByRole("dialog", { name: "گذرواژه حساب" });
  expect(within(dialog).getByLabelText("گذرواژه جدید")).toHaveAttribute("type", "password");
  expect(within(dialog).getByLabelText("تکرار گذرواژه")).toBeRequired();
  fireEvent.click(within(dialog).getByText("بستن", { selector: "button" }));
  await waitFor(() => expect(screen.queryByLabelText("گذرواژه جدید")).toBeNull());
  expect(
    screen.getByRole("button", { name: `${L.changePassword}: ${L.passwordTitle}` }),
  ).toHaveFocus();
});

it("opens the German account closure workflow only when requested", () => {
  const L = authScreensMessagesForLocale("de").flow;
  render(
    <LocaleProvider locale="de">
      <SecuritySettings initial={status} />
    </LocaleProvider>,
  );
  expect(screen.queryByLabelText("Grund oder Hinweise")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: `${L.requestClosure}: ${L.closureTitle}` }));
  const dialog = screen.getByRole("dialog", { name: "Konto schließen" });
  expect(within(dialog).getByLabelText("Grund oder Hinweise")).toHaveAttribute("maxLength", "2000");
});

it.each(["en", "de", "fa"] as const)(
  "distinguishes security actions by localized row context and restores Close focus in %s",
  async (locale) => {
    const L = authScreensMessagesForLocale(locale).flow;
    render(
      <LocaleProvider locale={locale}>
        <SecuritySettings
          initial={{
            ...status,
            fresh: false,
            accounts: [{ id: "linked", providerId: "github", accountId: "linked-account" }],
          }}
        />
      </LocaleProvider>,
    );
    const titles = [L.passkeysTitle, L.mfaSettingsTitle, L.methodsTitle];
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: L.manage })).toHaveLength(0);
    expect(screen.getByRole("button", { name: L.confirmIdentity })).toHaveTextContent(
      L.confirmIdentity,
    );
    for (const title of titles) {
      const trigger = screen.getByRole("button", { name: `${L.manage}: ${title}` });
      expect(trigger).toHaveTextContent(L.manage);
      expect(trigger.textContent).toBe(L.manage);
      trigger.focus();
      fireEvent.click(trigger);
      const dialog = screen.getByRole("dialog", { name: title });
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
      for (const other of titles.filter((value) => value !== title)) {
        expect(screen.queryByRole("dialog", { name: other })).not.toBeInTheDocument();
      }
      fireEvent.click(within(dialog).getByText(L.close, { selector: "button", exact: true }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(trigger).toHaveFocus();
    }
    expect(securityAction).not.toHaveBeenCalled();
    expect(document.documentElement.dir).toBe(locale === "fa" ? "rtl" : "ltr");
  },
);
