import { expect, it } from "vitest";
import { workspaceNavItems } from "./workspaceNavigation";

it("shows Projects only when native project navigation allows it, independently of work access", () => {
  expect(workspaceNavItems([], false, true).some((item) => item.href === "/projects")).toBe(true);
  expect(workspaceNavItems([], true, false).some((item) => item.href === "/projects")).toBe(false);
  expect(workspaceNavItems([], true).some((item) => item.href === "/projects")).toBe(false);
});

it("shows Inventory when its own navigation capability is enabled", () => {
  expect(
    workspaceNavItems(["work"], true, true, true).find((item) => item.key === "inventory"),
  ).toBeUndefined();
  expect(
    workspaceNavItems(["work"], false, false, false, true).find((item) => item.key === "inventory")
      ?.href,
  ).toBe("/inventory");
});

it("gives audit-only staff an independent destination without granting the Assets register", () => {
  const destinations = (assets: boolean, bookings: boolean, audits?: boolean) =>
    workspaceNavItems([], false, false, false, false, assets, bookings, audits)
      .map(({ href }) => href)
      .filter((href) => href.startsWith("/assets"));

  expect(destinations(false, false)).toEqual([]);
  expect(destinations(false, false, true)).toEqual(["/assets/audits"]);
  expect(destinations(false, true, true)).toEqual(["/assets/bookings", "/assets/audits"]);
  expect(destinations(true, true, true)).toEqual(["/assets"]);
});

it("keeps established navigation when no module choice exists and gates work", () => {
  expect(workspaceNavItems([], false).find((item) => item.key === "dashboard")?.href).toBe(
    "/pipeline",
  );
  expect(workspaceNavItems([], false).some((v) => v.key === "work")).toBe(false);
  expect(workspaceNavItems([], true).some((v) => v.href === "/work")).toBe(true);
});
it("applies module choices identically to rail and shortcut item order, preserving settings", () => {
  const items = workspaceNavItems(["work", "contacts"], true);
  const keys = items.map((v) => v.key);
  expect(items.find((item) => item.key === "dashboard")?.href).toBe("/dashboard");
  expect(keys).toContain("work");
  expect(keys).toContain("contacts");
  expect(keys).toContain("settings");
  expect(keys).not.toContain("leads");
  expect(keys).not.toContain("activities");
});
