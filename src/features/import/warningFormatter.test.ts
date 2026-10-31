import { expect, it } from "vitest";
import { formatImportWarning } from "./warningFormatter";

it("localizes imported owner warnings without modifying their stored contract", () => {
  const warning = {
    field: "owner",
    message: 'owner "alex@example.com" not assigned: no matching user',
  };
  const original = structuredClone(warning);
  expect(formatImportWarning(warning, { locale: "fa" })).toContain("کاربر مطابقی پیدا نشد");
  expect(formatImportWarning(warning, { locale: "de" })).toContain("kein passender Benutzer");
  expect(formatImportWarning(warning, { locale: "en" })).toBe(
    `${warning.field}: ${warning.message}`,
  );
  expect(warning).toEqual(original);
});
