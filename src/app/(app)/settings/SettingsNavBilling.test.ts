import { describe, expect, it } from "vitest";
import { settingsMessagesForLocale } from "@/features/identity/settingsMessages";
import { settingsNavSections } from "./settingsNavSections";

describe("Billing Settings discoverability", () => {
  it.each([
    [false, false, false],
    [false, true, false],
    [true, false, false],
    [true, true, true],
  ])(
    "administrator=%s billing enabled=%s yields visible=%s",
    (isAdmin, billingEnabled, visible) => {
      const routes = settingsNavSections(settingsMessagesForLocale("en"), "en", {
        isAdmin,
        billingEnabled,
        canManageCompany: true,
        canImport: false,
      }).flatMap((section) => section.items.map((item) => item.href));
      expect(routes.includes("/settings/billing")).toBe(visible);
    },
  );
});
