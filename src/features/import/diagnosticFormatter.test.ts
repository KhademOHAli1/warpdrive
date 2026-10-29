import { expect, it } from "vitest";
import type { CustomFieldDef } from "@/types/customFields";
import {
  formatImportDiagnostic,
  importDiagnosticField,
  importDiagnosticMessage,
} from "./diagnosticFormatter";
import { validateMappedRow } from "./mapRow";

const def: CustomFieldDef = {
  id: "cf1",
  targetEntity: "person",
  type: "text",
  name: "شناسه مشتری",
  key: "customer_code",
  options: [],
  isRequired: true,
  isImportant: false,
  showInAddForm: false,
  order: 0,
  archivedAt: null,
};

it("renders actual current custom-field validation failures with the administrator label", () => {
  const result = validateMappedRow(
    "person",
    { primary: { name: "Ali", customFields: { customer_code: "" } } },
    [def],
  );
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(
    result.errors.map((error) => formatImportDiagnostic(error, { locale: "fa", defs: [def] })),
  ).toContain("شناسه مشتری: تکمیل این فیلد ضروری است.");
  expect(
    result.errors.map((error) => formatImportDiagnostic(error, { locale: "en", defs: [def] })),
  ).toContain("شناسه مشتری: This field is required.");
});

it("keeps user-supplied names/values while localizing known contracts and selected digits", () => {
  expect(importDiagnosticMessage("unknown pipeline: Sales شرق", { locale: "fa" })).toBe(
    "مسیر فروش پیدا نشد: Sales شرق",
  );
  expect(
    importDiagnosticMessage('ambiguous organization "Acme": 12 matches', { locale: "fa" }),
  ).toBe("چند مخاطب مطابق پیدا شد: ۱۲");
  expect(
    importDiagnosticMessage("ambiguous match: 12 existing contacts", {
      locale: "fa",
      numberingSystem: "latn",
    }),
  ).toBe("چند مخاطب مطابق پیدا شد: 12");
  expect(importDiagnosticField("customFields.customer_code", { locale: "en", defs: [def] })).toBe(
    "شناسه مشتری",
  );
  expect(
    importDiagnosticField("customFields.window.start", {
      locale: "fa",
      defs: [{ ...def, key: "window", type: "time_range", name: "زمان تماس" }],
    }),
  ).toBe("شروع زمان تماس");
});

it("does not expose unknown schema paths, retired keys, or historical prose in either language", () => {
  for (const locale of ["en", "fa"] as const) {
    for (const field of [
      "constructor",
      "__proto__",
      "toString",
      "privateDatabaseColumn",
      "customFields.retired_key",
    ]) {
      const formatted = formatImportDiagnostic(
        { field, message: "email provider SQL required secret" },
        { locale },
      );
      expect(formatted).not.toContain(field);
      expect(formatted).not.toMatch(/provider|SQL|secret/);
      expect(formatted).toContain(locale === "fa" ? "مقدار واردشده معتبر نیست." : "Invalid value.");
    }
  }
});

it("recognizes current Zod diagnostics and nested field paths without translating file data", () => {
  const result = validateMappedRow(
    "person",
    {
      primary: { name: "", emails: [{ value: "not-email", label: "work" }] },
      organization: { name: "Org", employeeCount: "many" },
    },
    [],
  );
  expect(result.ok).toBe(false);
  if (result.ok) return;
  const formatted = result.errors.map((error) => formatImportDiagnostic(error, { locale: "fa" }));
  expect(formatted).toContain("نام: تکمیل این فیلد ضروری است.");
  expect(formatted).toContain("ایمیل: یک نشانی ایمیل معتبر وارد کنید.");
  expect(formatted).toContain("سازمان[تعداد کارکنان]: یک عدد معتبر وارد کنید.");
});

it("uses the import target for primary fields and related entity prefixes for linked records", () => {
  expect(importDiagnosticField("currency", { locale: "fa", target: "deal" })).toBe("ارز");
  expect(importDiagnosticField("dueAt", { locale: "fa", target: "activity" })).toBe("تاریخ سررسید");
  expect(importDiagnosticField("organization.address.city", { locale: "en", target: "lead" })).toBe(
    "Organization[Address: city]",
  );
  expect(
    importDiagnosticField("person.customFields.customer_code", {
      locale: "fa",
      target: "deal",
      defs: [{ ...def, targetEntity: "deal" }],
    }),
  ).toBe("فرد[فیلد سفارشی]");
});
