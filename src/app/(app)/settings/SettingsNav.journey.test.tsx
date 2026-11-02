// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MouseEventHandler, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";

const route = vi.hoisted(() => ({ pathname: "/settings/users" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));
vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: vi.fn() }));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    onClick,
    ...props
  }: {
    href: string;
    children: ReactNode;
    onClick?: MouseEventHandler<HTMLAnchorElement>;
  }) => (
    <a
      href={href}
      {...props}
      onClick={(event) => {
        event.preventDefault();
        onClick?.(event);
      }}
    >
      {children}
    </a>
  ),
}));

import { SettingsNav } from "./SettingsNav";

afterEach(() => {
  cleanup();
  route.pathname = "/settings/users";
  document.documentElement.dir = "ltr";
  document.documentElement.lang = "en";
});

describe("settings navigation journey", () => {
  it("finds permitted destinations by title and category while hiding unrelated groups", async () => {
    const user = userEvent.setup();
    render(<SettingsNav isAdmin={false} canManageCompany canImport={false} />);
    const search = screen.getByRole("searchbox", { name: "Search settings" });
    await user.type(search, "workspace");
    expect(screen.getByRole("link", { name: "Users" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Profile" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Enrichment" })).not.toBeInTheDocument();
    await user.clear(search);
    await user.type(search, "permission");
    expect(screen.getByRole("link", { name: "Permission sets" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Users" })).not.toBeInTheDocument();
  });

  it("explains an empty search and lets the user clear it without losing the current page", async () => {
    const user = userEvent.setup();
    render(<SettingsNav isAdmin={false} canManageCompany={false} canImport={false} />);
    await user.type(screen.getByRole("searchbox", { name: "Search settings" }), "enrichment");
    expect(screen.getByRole("status")).toHaveTextContent("No settings found.");
    expect(screen.queryByRole("link", { name: "Enrichment" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear settings search" }));
    expect(screen.getByRole("link", { name: "Profile" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search settings" })).toHaveValue("");
  });

  it("opens a named mobile sheet, contains focus and returns focus on Escape", async () => {
    const user = userEvent.setup();
    render(<SettingsNav isAdmin canManageCompany canImport />);
    const trigger = screen.getByRole("button", { name: "Settings category: Users" });
    await user.click(trigger);
    const sheet = screen.getByRole("dialog", { name: "Settings sections" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(sheet).toHaveAttribute("data-side", "left");
    expect(within(sheet).getByRole("searchbox", { name: "Search settings" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(sheet).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("closes the sheet after choosing even the current destination", async () => {
    const user = userEvent.setup();
    render(<SettingsNav isAdmin canManageCompany canImport />);
    await user.click(screen.getByRole("button", { name: "Settings category: Users" }));
    const sheet = screen.getByRole("dialog", { name: "Settings sections" });
    await user.click(within(sheet).getByRole("link", { name: "Users" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("closes an open sheet when back or another route change selects a new destination", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<SettingsNav isAdmin canManageCompany canImport />);
    await user.click(screen.getByRole("button", { name: "Settings category: Users" }));
    route.pathname = "/settings/company/pipelines";
    rerender(<SettingsNav isAdmin canManageCompany canImport />);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Settings category: Pipelines" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByRole("link", { name: "Pipelines" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Workspace details" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("uses the Farsi current label and logical-start sheet without exposing forbidden settings", async () => {
    const user = userEvent.setup();
    route.pathname = "/settings/profile";
    render(
      <LocaleProvider locale="fa">
        <SettingsNav isAdmin={false} canManageCompany={false} canImport={false} />
      </LocaleProvider>,
    );
    await user.click(screen.getByRole("button", { name: "دسته‌بندی تنظیمات: پروفایل" }));
    const sheet = screen.getByRole("dialog", { name: "بخش‌های تنظیمات" });
    expect(sheet).toHaveAttribute("dir", "rtl");
    expect(sheet).toHaveAttribute("data-side", "right");
    await user.type(within(sheet).getByRole("searchbox", { name: "جست‌وجو در تنظیمات" }), "امنیت");
    expect(within(sheet).getByRole("link", { name: "امنیت حساب" })).toBeInTheDocument();
    expect(within(sheet).queryByRole("link", { name: "مدیریت امنیت" })).not.toBeInTheDocument();
  });
});
