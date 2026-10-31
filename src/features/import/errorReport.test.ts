import { expect, it } from "vitest";
import { buildErrorCsv } from "./errorReport";

it("builds a CSV of invalid rows with flattened error reasons", () => {
  const csv = buildErrorCsv([
    {
      rowNumber: 2,
      raw: { Name: "", Email: "a@x.co" },
      errors: [{ field: "name", message: "required" }],
      warnings: [],
    },
    {
      rowNumber: 5,
      raw: { Name: "=CMD", Email: "" },
      errors: [{ field: "emails", message: "invalid" }],
      warnings: [],
    },
  ]);
  const lines = csv.split("\n");
  expect(lines[0]).toBe("row,errors,warnings,Name,Email");
  expect(lines[1]).toBe("2,Name: This field is required.,,,a@x.co");
  // Formula-injection cell is neutralized with a leading apostrophe.
  expect(lines[2]).toContain("'=CMD");
});

it("localizes only diagnostic cells for the current viewer and leaves stored input intact", () => {
  const rows = [
    {
      rowNumber: 12,
      raw: { Name: "علی, رضا", Email: "=CMD\nraw" },
      errors: [
        { field: "emails.0.value", message: "Invalid email address" },
        { field: "organization.name", message: "Required" },
        { field: "legacyInternalKey", message: "historical English implementation details" },
      ],
    },
  ];
  const snapshot = structuredClone(rows);
  const fa = buildErrorCsv(rows, { locale: "fa" });
  expect(fa).toBe(
    'row,errors,warnings,Name,Email\n12,ایمیل: یک نشانی ایمیل معتبر وارد کنید.; سازمان[نام]: تکمیل این فیلد ضروری است.; فیلد: مقدار واردشده معتبر نیست. قالب داده و فیلدهای ضروری را بررسی کنید.,,"علی, رضا","\'=CMD\nraw"',
  );
  const en = buildErrorCsv(rows, { locale: "en" });
  expect(en).toContain(
    "Email: Enter a valid email address.; Organization[Name]: This field is required.; Field: Invalid value.",
  );
  expect(en).not.toMatch(/legacyInternalKey|historical English/);
  expect(rows).toEqual(snapshot);
});

it("flattens warnings into their own column", () => {
  const csv = buildErrorCsv([
    {
      rowNumber: 3,
      raw: { Name: "Acme" },
      errors: [],
      warnings: [
        { field: "owner", message: "owner not found" },
        { field: "stage", message: "stage created" },
      ],
    },
  ]);
  const lines = csv.split("\n");
  expect(lines[0]).toBe("row,errors,warnings,Name");
  expect(lines[1]).toBe("3,,owner: owner not found; stage: stage created,Acme");
});
