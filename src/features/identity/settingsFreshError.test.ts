import { expect, test } from "vitest";
import { settingsIdentityError, settingsMessagesForLocale } from "./settingsMessages";

test("fresh-authentication failures explain how to resume in Farsi and German", () => {
  expect(settingsIdentityError(settingsMessagesForLocale("fa"), "fresh_auth_required")).toContain(
    "هویت",
  );
  expect(settingsIdentityError(settingsMessagesForLocale("de"), "fresh_auth_required")).toContain(
    "Sicherheit",
  );
});
