import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { estimateSmsSegments } from "./smsSegmentation";

function estimate(text: string) {
  const result = estimateSmsSegments(text);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("expected valid SMS fixture");
  return result.value;
}

describe("SMS estimate boundaries", () => {
  it.each([
    ["A".repeat(160), "gsm7", 160, [160]],
    ["A".repeat(161), "gsm7", 161, [153, 8]],
    ["A".repeat(306), "gsm7", 306, [153, 153]],
    ["A".repeat(307), "gsm7", 307, [153, 153, 1]],
    ["^".repeat(80), "gsm7", 160, [160]],
    ["^".repeat(81), "gsm7", 162, [152, 10]],
    ["^".repeat(153), "gsm7", 306, [152, 152, 2]],
    [`${"A".repeat(152)}^${"A".repeat(152)}`, "gsm7", 306, [152, 153, 1]],
    ["س".repeat(70), "unicode", 70, [70]],
    ["س".repeat(71), "unicode", 71, [67, 4]],
    ["س".repeat(134), "unicode", 134, [67, 67]],
    ["س".repeat(135), "unicode", 135, [67, 67, 1]],
    ["😀".repeat(35), "unicode", 70, [70]],
    ["😀".repeat(36), "unicode", 72, [66, 6]],
    ["😀".repeat(67), "unicode", 134, [66, 66, 2]],
    [`${"س".repeat(66)}😀${"س".repeat(66)}`, "unicode", 134, [66, 67, 1]],
    [`${"س".repeat(65)}😀${"س".repeat(67)}`, "unicode", 134, [67, 67]],
  ] as const)(
    "packs fixture %# without splitting encoded symbols",
    (text, encoding, units, parts) => {
      const value = estimate(text);
      expect(value.encoding).toBe(encoding);
      expect(value.units).toBe(units);
      expect(value.segmentUnits).toEqual(parts);
      expect(value.segments).toBe(parts.length);
      expect(value.segmentUnits.reduce((sum, part) => sum + part, 0)).toBe(units);
    },
  );

  it("reports capacities and units with an explicit estimate-only qualification", () => {
    expect(estimate("Hallo")).toEqual({
      originalText: "Hallo",
      encoding: "gsm7",
      unit: "septet",
      units: 5,
      segments: 1,
      segmentUnits: [5],
      singleSegmentCapacity: 160,
      multipartSegmentCapacity: 153,
      estimateOnly: true,
      uncertainty: ["provider_billing_unqualified"],
    });
    expect(estimate("سلام")).toMatchObject({
      encoding: "unicode",
      unit: "utf16_code_unit",
      singleSegmentCapacity: 70,
      multipartSegmentCapacity: 67,
      estimateOnly: true,
      uncertainty: ["provider_billing_unqualified"],
    });
  });
});

describe("GSM default and extension alphabets", () => {
  it.each(["ÄÖÜäöüß", "£$¥¤¡¿§", "èéùìòÇØøÅåÆæÉà", "Δ_ΦΓΛΩΠΨΣΘΞ", "@ !\"#%&'()*+,-./:;<=>?"])(
    "counts default-alphabet fixture %s as one septet per character",
    (text) => {
      expect(estimate(text)).toMatchObject({ encoding: "gsm7", units: text.length });
    },
  );
  it.each(["€", "^", "{", "}", "[", "]", "\\", "~", "|"])(
    "counts extension character %s as two septets",
    (text) => {
      expect(estimate(text)).toMatchObject({ encoding: "gsm7", units: 2 });
    },
  );
  it.each(["`", "ç", "á", "“Hallo”", "۱۲۳", "١٢٣", "می‌روم"])(
    "uses Unicode without transliteration for %s",
    (text) => {
      expect(estimate(text)).toMatchObject({ encoding: "unicode", units: text.length });
    },
  );
  it("recounts extension characters as single code units when any character needs Unicode", () => {
    expect(estimate(`${"^".repeat(69)}س`)).toMatchObject({
      encoding: "unicode",
      units: 70,
      segmentUnits: [70],
    });
  });
});

describe("preserved text and provider uncertainty", () => {
  it.each(["  سلام\r\n  دنیا  ", " Grüße\nWelt\r ", "می‌روم", "ا\u200dب", "a\u0308"])(
    "preserves fixture %# byte-for-byte without trimming or Unicode normalization",
    (text) => {
      const value = estimate(text);
      expect(value.originalText).toBe(text);
      expect(Buffer.from(value.originalText)).toEqual(Buffer.from(text));
    },
  );
  it("keeps decomposed German text distinct from its GSM precomposed spelling", () => {
    expect(estimate("ä")).toMatchObject({ encoding: "gsm7", units: 1 });
    expect(estimate("a\u0308")).toMatchObject({ encoding: "unicode", units: 2 });
  });
  it("counts CR and LF separately and preserves CRLF without rewriting line endings", () => {
    expect(estimate("A\r\nB\nC\rD")).toMatchObject({
      originalText: "A\r\nB\nC\rD",
      encoding: "gsm7",
      units: 8,
    });
  });
  it.each(["😀", "👨‍👩‍👧‍👦", "🇩🇪", "سلام 😀", "𝄞"])(
    "flags non-BMP fixture %# for provider qualification",
    (text) => {
      expect(estimate(text)).toMatchObject({
        encoding: "unicode",
        units: text.length,
        uncertainty: ["provider_billing_unqualified", "non_bmp_unqualified"],
      });
    },
  );
});

describe("SMS text validation", () => {
  it.each([undefined, null, 12, {}, [], new String("Hallo")])(
    "rejects non-string fixture %#",
    (text) => {
      expect(estimateSmsSegments(text)).toEqual({ ok: false, error: { code: "invalid_type" } });
    },
  );
  it.each(["", " ", " \r\n ", "\u00a0", "\u3000"])("rejects blank fixture %#", (text) => {
    expect(estimateSmsSegments(text)).toEqual({ ok: false, error: { code: "empty_text" } });
  });
  it.each(["\ud800", "\udfff", "a\ud800z", "a\udfffz", "\ud800\ud800", "\udc00\udc00"])(
    "rejects malformed UTF-16 fixture %# without echoing message contents",
    (text) => {
      const result = estimateSmsSegments(text);
      expect(result).toEqual({
        ok: false,
        error: { code: "invalid_utf16", utf16Index: text.startsWith("a") ? 1 : 0 },
      });
    },
  );
  const prohibitedControls = Array.from({ length: 160 }, (_, code) => code).filter(
    (code) => (code < 32 && code !== 10 && code !== 13) || code >= 127,
  );
  it.each(prohibitedControls)("rejects control U+%i including ESC, tab and form feed", (code) => {
    expect(estimateSmsSegments(`سلام${String.fromCharCode(code)}Welt`)).toEqual({
      ok: false,
      error: { code: "unsupported_control", utf16Index: 4 },
    });
  });
  it("reports an error index in UTF-16 units even after a supplementary character", () => {
    expect(estimateSmsSegments("😀\u001bprivate body")).toEqual({
      ok: false,
      error: { code: "unsupported_control", utf16Index: 2 },
    });
  });
});
