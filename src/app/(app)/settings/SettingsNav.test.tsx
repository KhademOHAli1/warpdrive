// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const route = vi.hoisted(() => ({ pathname: "/settings/users" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { SettingsNav } from "./SettingsNav";

afterEach(() => {
  cleanup();
  route.pathname = "/settings/users";
});

describe("SettingsNav", () => {
  it("renders a leading icon on each nav item (Pipedrive parity)", () => {
    render(<SettingsNav isAdmin={true} canManageCompany={true} canImport={true} />);
    const profile = screen.getByRole("link", { name: "Profile" });
    expect(profile.querySelector("svg")).not.toBeNull();
  });

  it("marks the active item with the Pipedrive blue treatment (not the neutral gray)", () => {
    render(<SettingsNav isAdmin={true} canManageCompany={true} canImport={true} />);
    const active = screen.getByRole("link", { name: /Users/ });
    expect(active.getAttribute("aria-current")).toBe("page");
    // PD highlights the active settings item in blue (text + tinted background), not bg-accent gray.
    expect(active.className).toMatch(/text-blue-700/);
    expect(active.className).toMatch(/bg-blue-50/);
    expect(active.className).not.toContain("bg-accent");
  });

  it("renders idle items in the foreground color, not muted gray (PD near-black)", () => {
    render(<SettingsNav isAdmin={true} canManageCompany={true} canImport={true} />);
    const idle = screen.getByRole("link", { name: /Notifications/ });
    expect(idle.getAttribute("aria-current")).toBeNull();
    expect(idle.className).toContain("text-foreground");
  });

  it("links Connected apps from every account settings menu", () => {
    render(<SettingsNav isAdmin={false} canManageCompany={false} canImport={false} />);
    expect(screen.getByRole("link", { name: /Connected apps/ })).toHaveAttribute(
      "href",
      "/settings/connections",
    );
  });

  // The enrichment page, its config query and its settings actions all require a real admin,
  // so the MANAGE flag alone must not surface a link into that denial page.
  it("shows Enrichment to a real admin", () => {
    render(<SettingsNav isAdmin={true} canManageCompany={true} canImport={false} />);
    expect(screen.getByRole("link", { name: /Enrichment/ })).toHaveAttribute(
      "href",
      "/settings/enrichment",
    );
  });

  it("hides Enrichment from a manager who is not an admin, keeping the rest of the section", () => {
    render(<SettingsNav isAdmin={false} canManageCompany={true} canImport={false} />);
    expect(screen.getByRole("link", { name: /Users/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Enrichment/ })).toBeNull();
  });

  it("renders no company section for a user with neither admin nor manage", () => {
    render(<SettingsNav isAdmin={false} canManageCompany={false} canImport={false} />);
    expect(screen.queryByRole("region", { name: "Workspace" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Sales & workflow" })).toBeNull();
    expect(screen.queryByRole("link", { name: /Users/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Enrichment/ })).toBeNull();
  });
});

it("groups each setting by task and keeps company catalogs out of Workspace", () => {
  render(<SettingsNav isAdmin canManageCompany canImport />);
  const personal = within(screen.getByRole("region", { name: "Personal" }));
  expect(personal.getByRole("link", { name: "Language & region" })).toHaveAttribute(
    "href",
    "/settings/regional",
  );
  expect(personal.getByRole("link", { name: "Appearance" })).toHaveAttribute(
    "href",
    "/settings/appearance",
  );
  expect(personal.getByRole("link", { name: "Workflow preferences" })).toHaveAttribute(
    "href",
    "/settings/workflow",
  );
  const sales = within(screen.getByRole("region", { name: "Sales & workflow" }));
  expect(sales.getByRole("link", { name: "Pipelines" })).toHaveAttribute(
    "href",
    "/settings/company/pipelines",
  );
  expect(
    within(screen.getByRole("region", { name: "Workspace" })).queryByRole("link", {
      name: "Pipelines",
    }),
  ).toBeNull();
});

it("marks only the catalog link active on a nested company route", () => {
  route.pathname = "/settings/company/pipelines";
  render(<SettingsNav isAdmin canManageCompany canImport />);
  expect(screen.getByRole("link", { name: "Pipelines" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "Workspace details" })).not.toHaveAttribute(
    "aria-current",
  );
  expect(
    screen.getAllByRole("link").filter((link) => link.hasAttribute("aria-current")),
  ).toHaveLength(1);
});

it("keeps import available without exposing workspace administration", () => {
  render(<SettingsNav isAdmin={false} canManageCompany={false} canImport />);
  expect(screen.getByRole("link", { name: "Import data" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Data fields" })).toBeNull();
  expect(screen.queryByRole("region", { name: "Workspace" })).toBeNull();
});

it("exposes personal security to every account and gates workspace security administration", () => {
  const { unmount } = render(
    <SettingsNav isAdmin={false} canManageCompany={false} canImport={false} />,
  );
  expect(screen.getByRole("link", { name: "Account security" })).toHaveAttribute(
    "href",
    "/settings/security",
  );
  expect(screen.queryByRole("link", { name: "Security administration" })).toBeNull();
  unmount();
  render(<SettingsNav isAdmin={false} canManageCompany canImport={false} />);
  expect(screen.getByRole("link", { name: "Security administration" })).toHaveAttribute(
    "href",
    "/settings/security-admin",
  );
});
