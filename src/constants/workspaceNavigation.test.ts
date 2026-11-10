import { expect, it } from "vitest";
import { workspaceNavItems } from "./workspaceNavigation";

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
