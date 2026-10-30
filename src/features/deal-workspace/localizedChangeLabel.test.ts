import { describe, expect, it } from "vitest";
import { formatChangeLabel } from "./changeLabel";

function withoutIsolation(text: string): string {
  return text.replace(/[\u2066-\u2069]/g, "");
}

describe("localized numeric audit display", () => {
  it("honors the Farsi digit preference for decimal strings and number primitives", () => {
    const entry = { field: "value", oldValue: "1234.56", newValue: 1234.5678 };
    expect(withoutIsolation(formatChangeLabel(entry, "fa", "latn"))).toContain(
      "از «1,234.56» به «1,234.5678»",
    );
    expect(withoutIsolation(formatChangeLabel(entry, "fa", "arabext"))).toContain(
      "از «۱٬۲۳۴٫۵۶» به «۱٬۲۳۴٫۵۶۷۸»",
    );
  });
  it("formats German money strings without rounding the recorded decimal", () => {
    const entry = { field: "value", oldValue: "1234.56", newValue: "1234.5678" };
    expect(withoutIsolation(formatChangeLabel(entry, "de"))).toBe("Betrag: 1.234,56 → 1.234,5678");
    expect(entry).toEqual({ field: "value", oldValue: "1234.56", newValue: "1234.5678" });
    expect(withoutIsolation(formatChangeLabel({ ...entry, newValue: 1234.5678 }, "de"))).toContain(
      "1.234,5678",
    );
  });

  it("keeps high-precision decimal strings exact in German and Persian", () => {
    const entry = { field: "value", oldValue: null, newValue: "9007199254740993.1234" };
    expect(withoutIsolation(formatChangeLabel(entry, "de"))).toContain(
      "9.007.199.254.740.993,1234",
    );
    expect(withoutIsolation(formatChangeLabel(entry, "fa"))).toContain(
      "۹٬۰۰۷٬۱۹۹٬۲۵۴٬۷۴۰٬۹۹۳٫۱۲۳۴",
    );
  });

  it("formats recognized organization numbers, including enriched values", () => {
    expect(
      withoutIsolation(
        formatChangeLabel(
          {
            field: "org.annualRevenue",
            oldValue: "1234.56",
            newValue: { value: "2345.6789", providers: ["Apollo"] },
          },
          "de",
        ),
      ),
    ).toContain("1.234,56 → 2.345,6789");
    expect(
      withoutIsolation(
        formatChangeLabel({ field: "org.employeeCount", oldValue: "1234", newValue: 2345 }, "fa"),
      ),
    ).toContain("از «۱٬۲۳۴» به «۲٬۳۴۵»");
  });

  it("uses the viewer's list separator while preserving authored array entries", () => {
    const entry = { field: "labels", oldValue: null, newValue: ["1234.56", "Acme"] };
    expect(withoutIsolation(formatChangeLabel(entry, "de"))).toContain("1234.56, Acme");
    expect(withoutIsolation(formatChangeLabel(entry, "fa"))).toContain("1234.56، Acme");
    expect(entry.newValue).toEqual(["1234.56", "Acme"]);
  });

  it("preserves numeric-looking authored strings, unsupported payloads and English history", () => {
    for (const field of ["title", "stageId", "custom_field:budget", "unknown_numeric_field"]) {
      expect(
        withoutIsolation(
          formatChangeLabel({ field, oldValue: "1234.56", newValue: "1234.5678" }, "de"),
        ),
      ).toContain("1234.56 → 1234.5678");
    }
    for (const authored of ["€1234.56", "1,234.56", "1e3"]) {
      expect(
        withoutIsolation(
          formatChangeLabel({ field: "value", oldValue: null, newValue: authored }, "de"),
        ),
      ).toContain(authored);
    }
    expect(
      formatChangeLabel({ field: "value", oldValue: "1234.56", newValue: "1234.5678" }, "en"),
    ).toBe("Value: 1234.56 → 1234.5678");
  });
});
