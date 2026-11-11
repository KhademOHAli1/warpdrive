import { expect, it } from "vitest";
import type { PermissionFlagKey } from "@/constants/permissionFlags";
import type { PermSetUser } from "@/features/permissions/effective";
import { hasNewsletterPermission, newsletterOperationAccess } from "./permissions";

function staff(...flags: PermissionFlagKey[]): PermSetUser {
  return {
    id: "synthetic-staff",
    type: "regular",
    isActive: true,
    groupIds: new Set(),
    flags: new Set(flags),
  };
}

it("separates authoring, delivery, consent, and operations", () => {
  const author = staff("newsletter.view", "newsletter.edit");
  expect(hasNewsletterPermission(author, "view")).toBe(true);
  expect(hasNewsletterPermission(author, "edit")).toBe(true);
  expect(hasNewsletterPermission(author, "send")).toBe(false);
  expect(hasNewsletterPermission(author, "consent")).toBe(false);
  expect(hasNewsletterPermission(author, "operate")).toBe(false);
  expect(hasNewsletterPermission(staff("newsletter.send"), "send")).toBe(false);
  expect(hasNewsletterPermission({ ...author, isActive: false, type: "admin" }, "view")).toBe(
    false,
  );
});

it("keeps unclassified operations and global subscriber data with administrators", () => {
  expect(newsletterOperationAccess("campaigns.list", "read")).toBe("view");
  expect(newsletterOperationAccess("crmAudience.freeze", "write")).toBe("edit");
  expect(newsletterOperationAccess("campaigns.status", "write")).toBe("send");
  expect(newsletterOperationAccess("subscribers.page", "read")).toBe("operate");
  expect(newsletterOperationAccess("campaigns.unregistered", "write")).toBe("operate");
});
