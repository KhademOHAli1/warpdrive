// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { SecurityStatus } from "../better/contracts";
import { SecuritySettings } from "./SecuritySettings";

vi.mock("../better/client", () => ({ authClient: {} }));
vi.mock("./useAccountStatus", () => ({
  useAccountStatus: (status: SecurityStatus) => ({ status, error: null, refresh: vi.fn() }),
  useAuthProviders: () => ({ config: { providers: [], emailPassword: true, passkeys: true } }),
}));
afterEach(cleanup);
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
  render(
    <LocaleProvider locale="fa">
      <SecuritySettings initial={status} />
    </LocaleProvider>,
  );
  expect(screen.queryByLabelText("گذرواژه جدید")).toBeNull();
  expect(screen.getByText("ali@example.com")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "تغییر گذرواژه" }));
  const dialog = screen.getByRole("dialog", { name: "گذرواژه حساب" });
  expect(within(dialog).getByLabelText("گذرواژه جدید")).toHaveAttribute("type", "password");
  expect(within(dialog).getByLabelText("تکرار گذرواژه")).toBeRequired();
  fireEvent.click(within(dialog).getByText("بستن", { selector: "button" }));
  await waitFor(() => expect(screen.queryByLabelText("گذرواژه جدید")).toBeNull());
  expect(screen.getByRole("button", { name: "تغییر گذرواژه" })).toHaveFocus();
});

it("opens the German account closure workflow only when requested", () => {
  render(
    <LocaleProvider locale="de">
      <SecuritySettings initial={status} />
    </LocaleProvider>,
  );
  expect(screen.queryByLabelText("Grund oder Hinweise")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Kontoschließung anfordern" }));
  const dialog = screen.getByRole("dialog", { name: "Konto schließen" });
  expect(within(dialog).getByLabelText("Grund oder Hinweise")).toHaveAttribute("maxLength", "2000");
});
