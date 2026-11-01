// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { SettingsNav } from "./SettingsNav";

vi.mock("next/navigation", () => ({ usePathname: () => "/settings/privacy" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
afterEach(cleanup);

it.each([
  ["en", "Privacy requests"],
  ["de", "Datenschutzanfragen"],
  ["fa", "درخواست‌های حریم خصوصی"],
] as const)(
  "makes %s personal privacy available without administrator or reviewer authority",
  (locale, label) => {
    render(
      <LocaleProvider locale={locale}>
        <SettingsNav isAdmin={false} canManageCompany={false} canImport={false} />
      </LocaleProvider>,
    );
    const link = screen.getByRole("link", { name: label });
    expect(link).toHaveAttribute("href", "/settings/privacy");
    expect(link).toHaveAttribute("aria-current", "page");
    expect(link.querySelector("svg")).not.toBeNull();
    expect(
      screen.getAllByRole("link").filter((item) => item.hasAttribute("aria-current")),
    ).toHaveLength(1);
    expect(
      screen.queryByRole("link", { name: /Security administration|Sicherheitsverwaltung/u }),
    ).toBeNull();
  },
);
