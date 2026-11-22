import { describe, expect, it } from "vitest";
import {
  gs1PrintText,
  isInternalLabelCode,
  type LabelFormat,
  normalizeLabel,
  parseScannedLabel,
  physicalLabelScanUrl,
} from "./formats";

const origin = "https://ops.example.test:8443";
const internal = "wd-label:v1:AbCdEfGhIjKlMnOpQrStUv";
const gs = "\u001d";
const gtin = "09504000059118";

describe("physical label scanner links", () => {
  it("round trips only an internal, case-sensitive code across pasted links and QR reads", () => {
    const url = physicalLabelScanUrl(origin, internal);
    const expected = { format: "qr", value: internal, key: `text:${internal}` };
    expect(url).toBe(`${origin}/operations/scan?code=${encodeURIComponent(internal)}`);
    expect(parseScannedLabel(`]Q1${url}\r\n`, origin)).toEqual(expected);
    expect(parseScannedLabel(`/operations/scan?code=${internal}`, origin)).toEqual(expected);
    expect(parseScannedLabel(`${internal}\r`)).toEqual(expected);
    expect(parseScannedLabel(internal.toLowerCase())?.key).not.toBe(expected.key);
  });

  it("rejects malformed tokens and origin values before building links", () => {
    expect(isInternalLabelCode(internal)).toBe(true);
    for (const invalid of [
      internal.slice(0, -1),
      `${internal}=`,
      `${internal}\n`,
      "wd-label:v1:a",
    ]) {
      expect(isInternalLabelCode(invalid)).toBe(false);
      expect(physicalLabelScanUrl(origin, invalid)).toBeNull();
    }
    expect(parseScannedLabel("wd-label:v1:a")).toBeNull();
    expect(normalizeLabel("code128", internal)).toBeNull();
    expect(physicalLabelScanUrl("https://a.test@ops.example.test:8443", internal)).toBeNull();
    expect(physicalLabelScanUrl(`${origin}/different`, internal)).toBeNull();
    expect(physicalLabelScanUrl("file://localhost", internal)).toBeNull();
  });

  it("never interprets a third-party, malformed, or ambiguous address as an internal scan", () => {
    const query = `code=${encodeURIComponent(internal)}`;
    const url = `${origin}/operations/scan?${query}`;
    for (const invalid of [
      url.replace("ops.example.test", "foreign.example.test"),
      url.replace("8443", "8444"),
      url.replace("https://", "http://"),
      url.replace("https://", "https://other.test@"),
      url.replace("/operations/", "/unknown/../operations/"),
      url.replace("/operations/", "/%6fperations/"),
      url.replace("/operations/", "\\operations\\"),
      `//ops.example.test:8443/operations/scan?${query}`,
      `${url}#`,
      `${url}&${query}`,
      `${url}&`,
      `${url}&other=1`,
      `${origin}/operations/scan?code=plausible-but-not-internal`,
      `https://untrusted.example.test/landing`,
      ` ${url}`,
      "javascript:alert(1)",
    ]) {
      expect(parseScannedLabel(invalid, origin), invalid).toBeNull();
    }
    expect(parseScannedLabel(url)).toBeNull();
    expect(parseScannedLabel(url, origin, "code128")).toBeNull();
  });
});

describe("plain barcode formats", () => {
  it("unifies matching plain values and preserves case, spaces, and digits", () => {
    const value = " DRIVE-01 ";
    const key = `text:${value}`;
    expect(parseScannedLabel(`${value}\r\n`)?.key).toBe(key);
    for (const format of ["qr", "datamatrix", "code39", "code128"] as const) {
      expect(normalizeLabel(format, value)).toEqual({ format, value, key });
    }
    expect(normalizeLabel("code128", "DRIVE-01")?.key).not.toBe(key);
    expect(parseScannedLabel("]C0vfd-001\n")).toEqual({
      format: "code128",
      value: "vfd-001",
      key: "text:vfd-001",
    });
    expect(parseScannedLabel("]d1VfD-001")?.key).toBe("text:VfD-001");
    expect(parseScannedLabel("]A0*AB*")?.key).toBe("text:AB");
    expect(parseScannedLabel("]A1ABL")?.key).toBe("text:AB");
    expect(parseScannedLabel("]A3AB")?.key).toBe("text:AB");
    expect(parseScannedLabel("]A1ABX")).toBeNull();
  });

  it("checks GTIN 13 without dropping leading digit or guessing a bare wedge scan", () => {
    const ean = "9504000059118";
    const key = `text:${ean}`;
    expect(parseScannedLabel(`]E0${ean}`)?.format).toBe("ean13");
    expect(parseScannedLabel(ean)).toEqual({ format: "qr", value: ean, key });
    expect(parseScannedLabel(ean, origin, "ean13")).toEqual({ format: "ean13", value: ean, key });
    expect(normalizeLabel("ean13", "0123456789012")?.value).toBe("0123456789012");
    expect(parseScannedLabel("]E09504000059119")).toBeNull();
    expect(parseScannedLabel(ean.slice(1), origin, "ean13")).toBeNull();
  });

  it("enforces application text limits without folding accents or accepting control characters", () => {
    expect(normalizeLabel("qr", "ö".repeat(1024))?.value.length).toBe(1024);
    expect(normalizeLabel("qr", "ö".repeat(1025))).toBeNull();
    expect(normalizeLabel("datamatrix", "Ω".repeat(512))?.value.length).toBe(512);
    expect(normalizeLabel("datamatrix", "Ω".repeat(513))).toBeNull();
    expect(normalizeLabel("qr", "á")?.key).not.toBe(normalizeLabel("qr", "a\u0301")?.key);
    expect(normalizeLabel("qr", "one\ntwo")).toBeNull();
    expect(normalizeLabel("qr", "https://other.example.test/label")).toBeNull();
    expect(normalizeLabel("qr", "one\u0000two")).toBeNull();
    expect(normalizeLabel("qr", "\uD800")).toBeNull();
    expect(parseScannedLabel("]Z0unsupported")).toBeNull();
    expect(parseScannedLabel("]C0ABC", origin, "code39")).toBeNull();
    expect(normalizeLabel("code128", "a".repeat(129))).toBeNull();
    expect(normalizeLabel("code128", "ä")).toBeNull();
    expect(normalizeLabel("code39", "lowercase")).toBeNull();
    expect(normalizeLabel("code39", "MID*DLE")).toBeNull();
  });
});

describe("GS1 elements", () => {
  it("maps equivalent HRI and wedge reads across carriers to one stable identity", () => {
    const normalized = normalizeLabel("gs1_128", `(21)X91(01)${gtin}(17)271231(10)aBc12`);
    const raw = `01${gtin}1727123110aBc12${gs}21X91`;
    expect(normalized).toEqual({
      format: "gs1_128",
      value: raw,
      key: `gs1:${raw}`,
      gs1: { "01": gtin, "17": "271231", "10": "aBc12", "21": "X91" },
    });
    expect(parseScannedLabel(`]C1${raw}\r\n`)).toEqual(normalized);
    expect(parseScannedLabel(`]d2${raw}`)).toEqual({ ...normalized, format: "gs1_datamatrix" });
    expect(parseScannedLabel(`]d2${gs}${raw}`)?.key).toBe(normalized?.key);
    expect(gs1PrintText(raw)).toBe(`(01)${gtin}(17)271231(10)aBc12(21)X91`);
    expect(parseScannedLabel(raw)?.key).toBe(normalized?.key);
    expect(parseScannedLabel(`01${gtin}`)?.format).toBe("qr");
    expect(parseScannedLabel(`01${gtin}`, origin, "gs1_datamatrix")?.gs1).toEqual({ "01": gtin });
  });

  it("keeps counts, dates and reference strings literal and escapes BWIPP parentheses", () => {
    const text = `(01)${gtin}(240)manu-A(241)Cust-42(251)source(400)PO-007(30)0009(17)280200(10)j\\(b)1`;
    const normalized = normalizeLabel("gs1_datamatrix", text);
    expect(normalized?.gs1).toEqual({
      "01": gtin,
      "17": "280200",
      "10": "j(b)1",
      "30": "0009",
      "240": "manu-A",
      "241": "Cust-42",
      "251": "source",
      "400": "PO-007",
    });
    expect(gs1PrintText(normalized?.value ?? "")).toBe(
      `(01)${gtin}(17)280200(10)j^040b^0411(240)manu-A(241)Cust-42(251)source(30)0009(400)PO-007`,
    );
    expect(normalizeLabel("gs1_128", text)).toBeNull();
    expect(normalizeLabel("gs1_datamatrix", `(02)${gtin}(37)45`)?.gs1?.["37"]).toBe("45");
  });

  it("does not guess a second field inside a separator-free variable value", () => {
    const raw = `01${gtin}10LOT21SERIAL`;
    const lot = parseScannedLabel(`]d2${raw}`);
    expect(lot?.gs1).toEqual({ "01": gtin, "10": "LOT21SERIAL" });
    expect(lot?.key).not.toBe(parseScannedLabel(`]d201${gtin}10LOT${gs}21SERIAL`)?.key);
  });

  it.each<[LabelFormat, string]>([
    ["gs1_datamatrix", "(01)09504000059119"],
    ["gs1_datamatrix", `(01)${gtin}(17)270229`],
    ["gs1_datamatrix", `(01)${gtin}(17)281301`],
    ["gs1_datamatrix", `(01)${gtin}(37)1`],
    ["gs1_datamatrix", `(01)${gtin}(10)abc(10)ABC`],
    ["gs1_datamatrix", `(01)${gtin}(10)`],
    ["gs1_datamatrix", `(01)${gtin}(30)001X`],
    ["gs1_datamatrix", `(01)${gtin}(10)${"A".repeat(21)}`],
    ["gs1_datamatrix", `(01)${gtin}(1234)unknown`],
    ["gs1_datamatrix", `(01)${gtin}(10)not^valid`],
    ["gs1_datamatrix", `(01)${gtin}(10)ABC\n(21)SERIAL`],
    ["gs1_datamatrix", `01${gtin}${gs}10ABC`],
    ["gs1_datamatrix", `01${gtin}10ABC${gs}`],
    ["gs1_datamatrix", `01${gtin}10ABC${gs}${gs}21X9`],
    ["gs1_128", `]d201${gtin}`],
  ])("rejects an invalid %s element string %j", (format, text) => {
    expect(normalizeLabel(format, text)).toBeNull();
  });
});
