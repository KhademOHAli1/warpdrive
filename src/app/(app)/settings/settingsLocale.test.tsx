// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { settingsMessagesForLocale } from "@/features/identity/settingsMessages";
import { formatCreatedOn } from "./email/formatDate";
import { mailboxStatusLabel } from "./email-sync/statusLabel";
import { buildColumnOptions } from "./import/MapStep";
import { SettingsNav } from "./SettingsNav";
import { InviteUserForm } from "./users/InviteUserForm";

vi.mock("next/navigation", () => ({
  usePathname: () => "/settings/users",
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: vi.fn() }));
const { invite } = vi.hoisted(() => ({ invite: vi.fn() }));
vi.mock("@/features/identity/actions/invite", () => ({ inviteUserAction: invite }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const fa = settingsMessagesForLocale("fa");

describe("Persian settings workflows", () => {
  it("localizes navigation while retaining routes, active state, and permission gates", () => {
    render(
      <LocaleProvider locale="fa">
        <SettingsNav isAdmin={false} canManageCompany canImport />
      </LocaleProvider>,
    );
    expect(screen.getByRole("link", { name: fa.users })).toHaveAttribute("href", "/settings/users");
    expect(screen.getByRole("link", { name: fa.users })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: fa._hierarchy.profile })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: fa._enrichment.nav })).not.toBeInTheDocument();
  });
  it("validates an invite in Persian and preserves the entered name and email", () => {
    render(
      <LocaleProvider locale="fa">
        <InviteUserForm onInvited={vi.fn()} />
      </LocaleProvider>,
    );
    fireEvent.change(screen.getByLabelText(fa._extra.email), { target: { value: "invalid" } });
    fireEvent.change(screen.getByLabelText(fa._extra.name), { target: { value: "سارا احمدی" } });
    fireEvent.click(screen.getByRole("button", { name: fa._extra.invite }));
    expect(screen.getByRole("alert")).toHaveTextContent(fa._extra.enter_a_valid_email_address);
    expect(screen.getByLabelText(fa._extra.name)).toHaveValue("سارا احمدی");
    expect(invite).not.toHaveBeenCalled();
  });
  it("localizes built-in import destinations without altering mapping identifiers or custom names", () => {
    const options = buildColumnOptions(
      "person",
      [{ key: "custom", name: "My Custom Field" }] as never,
      {},
      fa,
    );
    expect(options.find((o) => o.value === "s:person:name")?.label).toBe("فرد[نام] *");
    expect(options.find((o) => o.value === "c:custom")?.label).toBe("My Custom Field");
  });
  it("explains stalled email sync in Persian and formats template dates in the Iranian calendar", () => {
    expect(mailboxStatusLabel({ status: "error", lastSyncAtIso: null }, null, fa._emailSync)).toBe(
      fa._emailSync.statusStalled,
    );
    const date = formatCreatedOn("2026-03-21T00:30:00Z", {
      locale: "fa",
      calendar: "persian",
      timeZone: "UTC",
    });
    expect(date).toContain("فروردین");
    expect(date).toContain("۱۴۰۵");
  });
  it("keeps numbers raw through ICU plural evaluation and emits Persian digits", () => {
    expect(fa._extra.stageCount(12)).toBe("۱۲ مرحله");
    expect(fa._extra.progressText(2, 12, 17)).toContain("۱۲");
    expect(fa._extra.progressText(2, 12, 17)).not.toContain("NaN");
  });
});
