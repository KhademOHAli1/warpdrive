import { expect, test } from "vitest";
import { managementActionInput } from "./schemas";

test("management commands reject arbitrary account privilege input and oversized bulk operations", () => {
  expect(
    managementActionInput.safeParse({
      action: "invite",
      email: "user@example.com",
      name: "User",
      isAdmin: false,
      locale: "en",
      bypassMfa: true,
    }).success,
  ).toBe(false);
  expect(
    managementActionInput.safeParse({
      action: "bulkActive",
      userIds: Array.from({ length: 26 }, () => "00000000-0000-0000-0000-0000000000aa"),
      isActive: false,
    }).success,
  ).toBe(false);
});
