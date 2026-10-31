import { describe, expect, it } from "vitest";
import { normalizePhoneInput } from "./phoneNormalization";

describe("selected-country phone normalization", () => {
  it.each([
    ["۰۹۱۲ ۳۴۵ ۶۷۸۹", "IR", "+989123456789"],
    ["٠٩١٢ ٣٤٥ ٦٧٨٩", "IR", "+989123456789"],
    ["۰۲۱ ۸۸۷۷ ۶۶۵۵", "IR", "+982188776655"],
    ["030 23125 000", "DE", "+493023125000"],
    ["۰۳۰ ۲۳۱۲۵ ۰۰۰", "DE", "+493023125000"],
    ["0049 30 23125 000", "IR", "+493023125000"],
    ["+49 30 23125 000", "IR", "+493023125000"],
    ["+۹۸ ۹۱۲ ۳۴۵۶۷۸۹", "DE", "+989123456789"],
  ] as const)(
    "normalizes %s using %s without changing the author's input",
    (raw, country, e164) => {
      expect(normalizePhoneInput(raw, country)).toMatchObject({
        original: raw,
        country,
        e164,
        status: "valid",
      });
    },
  );

  it("preserves exact original bytes including whitespace while normalizing a separate value", () => {
    const raw = "  +۹۸ (۹۱۲) ۳۴۵-۶۷۸۹  ";
    expect(normalizePhoneInput(raw)).toEqual({
      original: raw,
      e164: "+989123456789",
      status: "valid",
    });
  });

  it("requires a selected region for national numbers instead of guessing from the digits or language", () => {
    expect(normalizePhoneInput("۰۹۱۲۳۴۵۶۷۸۹")).toEqual({
      original: "۰۹۱۲۳۴۵۶۷۸۹",
      status: "review",
      reason: "country_required",
    });
  });

  it.each(["call +98 9123456789", "+999123456789", "112", "12345", "+98\nprivate-note", ""])(
    "requires review for unsupported or ambiguous input %s",
    (raw) => {
      expect(normalizePhoneInput(raw, "IR")).toMatchObject({ original: raw, status: "review" });
      expect(normalizePhoneInput(raw, "IR").e164).toBeUndefined();
    },
  );

  it("keeps extensions explicit and requires review instead of treating a switchboard as a unique recipient", () => {
    expect(normalizePhoneInput("+49 30 23125000 ext. 12", "DE")).toMatchObject({
      original: "+49 30 23125000 ext. 12",
      e164: "+493023125000",
      extension: "12",
      status: "review",
      reason: "extension",
    });
  });
});
