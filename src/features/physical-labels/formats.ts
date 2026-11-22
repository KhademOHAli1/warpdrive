export const labelFormats = [
  "qr",
  "code128",
  "code39",
  "ean13",
  "datamatrix",
  "gs1_128",
  "gs1_datamatrix",
] as const;

export type LabelFormat = (typeof labelFormats)[number];

export const physicalLabelScanPath = "/operations/scan";
const internalPrefix = "wd-label:v1:";
const internalToken = /^[A-Za-z0-9_-]{22}$/;
const groupSeparator = "\u001d";
const maxScanLength = 4_096;
const code39Symbols = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%";
const textEncoder = new TextEncoder();
const controlOrInvalidText = /[\p{Cc}\p{Cs}]/u;

// Element widths, character sets and validators come from the GS1 Barcode Syntax Dictionary.
const gs1Rules = {
  "00": { fixed: 18, check: "mod10" },
  "01": { fixed: 14, check: "mod10" },
  "02": { fixed: 14, check: "mod10" },
  "10": { max: 20 },
  "11": { fixed: 6, check: "date" },
  "13": { fixed: 6, check: "date" },
  "15": { fixed: 6, check: "date" },
  "17": { fixed: 6, check: "date" },
  "21": { max: 20 },
  "30": { max: 8, check: "numeric" },
  "37": { max: 8, check: "numeric" },
  "240": { max: 30 },
  "241": { max: 30 },
  "251": { max: 30 },
  "400": { max: 30 },
} satisfies Record<string, Gs1Rule>;

export type Gs1ApplicationIdentifier = keyof typeof gs1Rules;
type Gs1Data = Partial<Record<Gs1ApplicationIdentifier, string>>;
type Gs1Format = Extract<LabelFormat, "gs1_128" | "gs1_datamatrix">;
type Gs1Rule = { fixed: number; check: "mod10" | "date" } | { max: number; check?: "numeric" };

export type NormalizedLabel = {
  format: LabelFormat;
  value: string;
  key: string;
  gs1?: Gs1Data;
};

const aimFormats: ReadonlyMap<string, LabelFormat> = new Map([
  ["]A0", "code39"],
  ["]A1", "code39"],
  ["]A3", "code39"],
  ["]C0", "code128"],
  ["]C1", "gs1_128"],
  ["]E0", "ean13"],
  ["]Q0", "qr"],
  ["]Q1", "qr"],
  ["]Q2", "qr"],
  ["]d1", "datamatrix"],
  ["]d2", "gs1_datamatrix"],
  ["]d4", "datamatrix"],
  ["]d5", "gs1_datamatrix"],
]);

function withoutScannerTerminator(raw: string): string {
  return raw.replace(/[\r\n]+$/, "");
}

export function isInternalLabelCode(raw: string): boolean {
  return (
    raw.length === internalPrefix.length + 22 &&
    raw.startsWith(internalPrefix) &&
    internalToken.test(raw.slice(internalPrefix.length))
  );
}

function scannerOrigin(raw: string): string | null {
  if (!/^https?:\/\/[^/?#@\\\s]+\/?$/i.test(raw)) return null;
  try {
    const url = new URL(raw);
    return url.username || url.password ? null : url.origin;
  } catch {
    return null;
  }
}

export function physicalLabelScanUrl(origin: string, internalCode: string): string | null {
  const base = scannerOrigin(origin);
  if (base === null || !isInternalLabelCode(internalCode)) return null;
  const url = new URL(physicalLabelScanPath, base);
  url.searchParams.set("code", internalCode);
  return url.href;
}

function readScannerLink(raw: string, origin: string | undefined): string | null {
  const expected = origin === undefined ? null : scannerOrigin(origin);
  if (expected === null || /[\\#\s]/.test(raw)) return null;
  const absolute = /^https?:\/\/[^/?#]+/i.exec(raw)?.[0];
  const relative = absolute === undefined ? raw : raw.slice(absolute.length);
  if (
    !relative.startsWith(`${physicalLabelScanPath}?`) ||
    (absolute !== undefined && scannerOrigin(absolute) !== expected)
  )
    return null;

  const query = relative.slice(physicalLabelScanPath.length + 1);
  if (!/^code=[^&]+$/.test(query)) return null;
  const params = new URLSearchParams(query);
  const code = params.get("code");
  return code !== null && isInternalLabelCode(code) ? code : null;
}

function mod10(value: string): boolean {
  if (!/^\d+$/.test(value)) return false;
  let sum = 0;
  for (let offset = 0; offset < value.length; offset++) {
    sum += Number(value[value.length - offset - 1]) * (offset % 2 === 0 ? 1 : 3);
  }
  return sum % 10 === 0;
}

function gs1Date(value: string): boolean {
  if (!/^\d{6}$/.test(value)) return false;
  const year = 2000 + Number(value.slice(0, 2));
  const month = Number(value.slice(2, 4));
  const day = Number(value.slice(4));
  // The date fields admitted here allow day 00 to express a month without specifying a day.
  return month >= 1 && month <= 12 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isGs1Id(id: string): id is Gs1ApplicationIdentifier {
  return Object.hasOwn(gs1Rules, id);
}

function validGs1Field(rule: Gs1Rule, value: string): boolean {
  if (controlOrInvalidText.test(value)) return false;
  if ("fixed" in rule) {
    return value.length === rule.fixed && (rule.check === "mod10" ? mod10(value) : gs1Date(value));
  }
  if (value.length < 1 || value.length > rule.max) return false;
  if (rule.check === "numeric") return /^\d+$/.test(value);
  return /^[0-9A-Za-z!"%&'()*+,./:;<=>?_-]+$/.test(value);
}

function addGs1Field(fields: Gs1Data, id: string, value: string): boolean {
  if (!isGs1Id(id) || fields[id] !== undefined || !validGs1Field(gs1Rules[id], value)) return false;
  fields[id] = value;
  return true;
}

function bracketedGs1(payload: string): Gs1Data | null {
  const fields: Gs1Data = {};
  const element = /\((\d{2,4})\)((?:\\\(|[^\\(])*)/y;
  while (element.lastIndex < payload.length) {
    const match = element.exec(payload);
    const id = match?.[1];
    const value = match?.[2];
    if (
      id === undefined ||
      value === undefined ||
      !addGs1Field(fields, id, value.replaceAll("\\(", "("))
    )
      return null;
  }
  return fields;
}

function readGs1Element(payload: string, offset: number) {
  const shortId = payload.slice(offset, offset + 2);
  const id = isGs1Id(shortId) ? shortId : payload.slice(offset, offset + 3);
  if (!isGs1Id(id)) return null;
  const rule = gs1Rules[id];
  const from = offset + id.length;
  if ("fixed" in rule) {
    const next = from + rule.fixed;
    return { id, value: payload.slice(from, next), next };
  }
  const separator = payload.indexOf(groupSeparator, from);
  if (separator === payload.length - 1) return null;
  if (separator < 0) return { id, value: payload.slice(from), next: payload.length };
  return { id, value: payload.slice(from, separator), next: separator + 1 };
}

function elementStringGs1(payload: string): Gs1Data | null {
  const fields: Gs1Data = {};
  let offset = 0;
  while (offset < payload.length) {
    const element = readGs1Element(payload, offset);
    if (element === null || !addGs1Field(fields, element.id, element.value)) return null;
    offset = element.next;
  }
  return fields;
}

function gs1Fields(raw: string): Gs1Data | null {
  // Several decoders preserve an initial FNC1 as GS before the element string.
  const payload = raw.startsWith(groupSeparator) ? raw.slice(1) : raw;
  if (!payload) return null;
  const fields = payload.startsWith("(") ? bracketedGs1(payload) : elementStringGs1(payload);
  if (fields?.["01"] !== undefined && (fields["02"] !== undefined || fields["37"] !== undefined))
    return null;
  return fields;
}

function gs1Entries(fields: Gs1Data): [Gs1ApplicationIdentifier, string][] {
  const ids = Object.keys(fields).filter(isGs1Id).sort();
  const fixed = ids.filter((id) => "fixed" in gs1Rules[id]);
  const variable = ids.filter((id) => !("fixed" in gs1Rules[id]));
  return [...fixed, ...variable].flatMap((id) => {
    const value = fields[id];
    return value === undefined ? [] : [[id, value]];
  });
}

function normalizeGs1(format: Gs1Format, raw: string): NormalizedLabel | null {
  const prefix = aimFormats.get(raw.slice(0, 3));
  if (prefix !== undefined && prefix !== format) return null;
  const fields = gs1Fields(prefix === undefined ? raw : raw.slice(3));
  if (fields === null) return null;

  const entries = gs1Entries(fields);
  const canonical = entries
    .map(
      ([id, value], index) =>
        id +
        value +
        (!("fixed" in gs1Rules[id]) && index < entries.length - 1 ? groupSeparator : ""),
    )
    .join("");
  // GS1-128 allows at most 48 data characters. FNC1 separators are symbol characters.
  if (format === "gs1_128" && canonical.replaceAll(groupSeparator, "").length > 48) return null;
  return { format, value: canonical, key: `gs1:${canonical}`, gs1: fields };
}

/** Encode bracketed AI input for BWIPP's GS1 encoders with its parse option enabled. */
export function gs1PrintText(rawCanonical: string): string | null {
  if (rawCanonical.length > maxScanLength) return null;
  const fields = gs1Fields(rawCanonical);
  if (fields === null) return null;
  return gs1Entries(fields)
    .map(([id, value]) => `(${id})${value.replaceAll("(", "^040").replaceAll(")", "^041")}`)
    .join("");
}

const plainRules = {
  ean13: (value: string) => value.length === 13 && mod10(value),
  code39: (value: string) =>
    value.length <= 128 && [...value].every((char) => code39Symbols.includes(char)),
  code128: (value: string) => /^[ -~]{1,128}$/.test(value),
  qr: (value: string) => textEncoder.encode(value).length <= 2_048,
  datamatrix: (value: string) => textEncoder.encode(value).length <= 1_024,
} satisfies Record<Exclude<LabelFormat, Gs1Format>, (value: string) => boolean>;

function looksLikeLink(value: string): boolean {
  return /^(?:https?:|\/\/|\/operations\/scan(?:[\\/?#]|$)|(?:javascript|data|file|vbscript):)/i.test(
    value.trimStart(),
  );
}

function normalizePlain(format: keyof typeof plainRules, raw: string): string | null {
  // Code 39's start/stop asterisks are sometimes included in the human-readable line.
  const value =
    format === "code39" && raw.startsWith("*") && raw.endsWith("*") ? raw.slice(1, -1) : raw;
  if (value.trim().length === 0 || controlOrInvalidText.test(value) || looksLikeLink(value))
    return null;
  if (value.startsWith(internalPrefix)) {
    return format === "qr" && isInternalLabelCode(value) ? value : null;
  }

  return plainRules[format](value) ? value : null;
}

export function normalizeLabel(format: LabelFormat, raw: string): NormalizedLabel | null {
  if (raw.length > maxScanLength) return null;
  const payload = withoutScannerTerminator(raw);
  if (format === "gs1_128" || format === "gs1_datamatrix") return normalizeGs1(format, payload);
  const value = normalizePlain(format, payload);
  return value === null ? null : { format, value, key: `text:${value}` };
}

function checkedCode39(raw: string): string | null {
  const value = normalizePlain("code39", raw);
  if (value === null || value.length < 2) return null;
  const data = value.slice(0, -1);
  const sum = [...data].reduce((total, char) => total + code39Symbols.indexOf(char), 0);
  return code39Symbols[sum % 43] === value.at(-1) ? data : null;
}

function normalizeScanPayload(payload: string, format: LabelFormat | undefined, origin?: string) {
  if (looksLikeLink(payload)) {
    if (format !== undefined && format !== "qr") return null;
    const code = readScannerLink(payload, origin);
    return code === null ? null : normalizeLabel("qr", code);
  }
  const inferred =
    /^\(\d{2,4}\)/.test(payload) || payload.includes(groupSeparator) ? "gs1_datamatrix" : "qr";
  return normalizeLabel(format ?? inferred, payload);
}

export function parseScannedLabel(
  raw: string,
  expectedOrigin?: string,
  formatHint?: LabelFormat,
): NormalizedLabel | null {
  if (raw.length > maxScanLength) return null;
  const scan = withoutScannerTerminator(raw);
  const prefix = scan.slice(0, 3);
  const aim = aimFormats.get(prefix);
  if (aim !== undefined && formatHint !== undefined && aim !== formatHint) return null;
  if (aim === undefined && formatHint === undefined && /^\][A-Za-z]\d/.test(scan)) return null;

  const payload = aim === undefined ? scan : scan.slice(3);
  if (prefix === "]A1") {
    const code = checkedCode39(payload);
    return code === null ? null : normalizeLabel("code39", code);
  }
  return normalizeScanPayload(payload, aim ?? formatHint, expectedOrigin);
}
