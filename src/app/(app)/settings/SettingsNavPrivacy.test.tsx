// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MouseEventHandler, ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { SettingsNav } from "./SettingsNav";

const route = vi.hoisted(() => ({ pathname: "/settings/privacy" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    onClick,
    ...rest
  }: {
    href: string;
    children: ReactNode;
    onClick?: MouseEventHandler<HTMLAnchorElement>;
  }) => (
    <a
      href={href}
      {...rest}
      onClick={(event) => {
        event.preventDefault();
        onClick?.(event);
      }}
    >
      {children}
    </a>
  ),
}));
afterEach(() => {
  cleanup();
  route.pathname = "/settings/privacy";
});

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

it.each([
  ["en", "Privacy requests"],
  ["de", "Datenschutzanfragen"],
  ["fa", "درخواست‌های حریم خصوصی"],
] as const)("keeps %s personal privacy searchable in the mobile sheet", async (locale, label) => {
  const user = userEvent.setup();
  route.pathname = "/settings/privacy/requests/00000000-0000-4000-8000-000000000001";
  render(
    <LocaleProvider locale={locale}>
      <SettingsNav isAdmin={false} canManageCompany={false} canImport={false} />
    </LocaleProvider>,
  );
  expect(screen.getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
  const trigger = screen.getByRole("button", { name: new RegExp(`${label}$`, "u") });
  await user.click(trigger);
  const sheet = screen.getByRole("dialog");
  expect(sheet).toHaveAttribute("data-side", locale === "fa" ? "right" : "left");
  if (locale === "fa") expect(sheet).toHaveAttribute("dir", "rtl");
  const forbidden = new Set([
    "/settings/security-admin",
    "/settings/permission-sets",
    "/settings/enrichment",
    "/settings/import",
  ]);
  expect(
    within(sheet)
      .getAllByRole("link")
      .some((link) => forbidden.has(link.getAttribute("href") ?? "")),
  ).toBe(false);
  await user.type(within(sheet).getByRole("searchbox"), label);
  const privacy = within(sheet).getByRole("link", { name: label });
  expect(privacy).toHaveAttribute("href", "/settings/privacy");
  expect(privacy).toHaveAttribute("aria-current", "page");
  await user.click(privacy);
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(trigger).toHaveFocus();
});
