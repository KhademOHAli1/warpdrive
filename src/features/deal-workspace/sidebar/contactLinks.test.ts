import { describe, expect, it } from "vitest";
import { externalHref, mailtoHref, telHref } from "./contactLinks";

describe("telHref", () => {
  it("prefixes tel: and strips spaces so the dialer gets a clean number", () => {
    expect(telHref("+1 555 949 5107")).toBe("tel:+15559495107");
  });

  it.each([
    ["+۹۸ (۹۱۲) ۳۴۵-۶۷۸۹", "tel:+989123456789"],
    ["+٩٨ (٩١٢) ٣٤٥-٦٧٨٩", "tel:+989123456789"],
    ["+۹8 (٩1۲) 3۴٥-6۷٨9", "tel:+989123456789"],
    ["(415) 555-1234 x۹۹", "tel:415555123499"],
    ["(415) 555-1234 x99", "tel:415555123499"],
  ])("preserves each phone digit in %s", (raw, href) => {
    expect(telHref(raw)).toBe(href);
  });
});

describe("mailtoHref", () => {
  it("prefixes mailto:", () => {
    expect(mailtoHref("ava@harborsystems.com")).toBe("mailto:ava@harborsystems.com");
  });
});

describe("externalHref", () => {
  it("leaves an absolute https url untouched", () => {
    expect(externalHref("https://www.linkedin.com/company/uniondynamics")).toBe(
      "https://www.linkedin.com/company/uniondynamics",
    );
  });

  it("leaves an absolute http url untouched", () => {
    expect(externalHref("http://example.com")).toBe("http://example.com");
  });

  it("prefixes https:// on a bare domain so a Website value opens", () => {
    expect(externalHref("uniondynamics.com")).toBe("https://uniondynamics.com");
  });

  it("trims surrounding whitespace before deciding on a scheme", () => {
    expect(externalHref("  uniondynamics.com ")).toBe("https://uniondynamics.com");
  });
});
