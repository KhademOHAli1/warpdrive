import { err, ok, type Result } from "@/types/result";
import { type CatalogUnit, catalogUnits } from "../catalog/contracts";
import type { ReleaseBomEntry } from "./schema";

const utf8 = new TextDecoder("utf-8", { fatal: true });
export const releaseBomMaxBytes = 64 * 1024;
const maxRows = 30;
const maxAlternates = 8;

const skuPattern = /^[A-Z0-9][A-Z0-9_.-]{0,39}$/;
const releasePattern = /^[A-Z0-9][A-Z0-9._-]{0,19}$/;
const wholeQuantity = /^[1-9]\d{0,6}$/;
const decimalQuantity = /^(?:0|[1-9]\d{0,6})(?:\.\d{1,6})?$/;
const safeRevision = /^[^@"|,\p{Cc}\p{Cf}]{1,20}$/u;
const skusOnly =
  /^\s*(?:"([A-Z0-9][A-Z0-9_.-]{0,39})"|([A-Z0-9][A-Z0-9_.-]{0,39}))\s*,\s*(?:"([1-9]\d{0,6})"|([1-9]\d{0,6}))\s*$/i;
const extras = new Set([
  "unit",
  "child_release",
  "alternates",
  "optional",
  "consumable",
  "inherited",
  "pieces",
]);

/** Cells use identifier/quantity fields only and cannot contain embedded delimiters or escapes. */
function cells(line: string): string[] | null {
  const values = line.split(",");
  const result: string[] = [];
  for (const raw of values) {
    const cell = raw.trim();
    if (cell.startsWith('"') && cell.endsWith('"') && cell.length >= 2) {
      const unquoted = cell.slice(1, -1);
      if (unquoted.includes('"')) return null;
      result.push(unquoted.trim());
    } else {
      if (cell.includes('"')) return null;
      result.push(cell);
    }
  }
  return result;
}

function selector(raw: string): string | null {
  const [code, revision, extra] = raw.trim().toUpperCase().split("@");
  if (code === undefined || !skuPattern.test(code) || extra !== undefined) return null;
  if (revision === undefined) return code;
  const key = revision.trim();
  return safeRevision.test(key) ? `${code}@${key}` : null;
}

function legacyRow(line: string): ReleaseBomEntry | null {
  const match = skusOnly.exec(line);
  if (match === null) return null;
  const sku = (match[1] ?? match[2] ?? "").toUpperCase();
  const quantity = Number(match[3] ?? match[4]);
  return quantity > 1_000_000 ? null : { sku, quantity };
}

function parseUnit(raw: string): CatalogUnit | null | undefined {
  if (!raw) return null;
  return catalogUnits.includes(raw as CatalogUnit) ? (raw as CatalogUnit) : undefined;
}

function parseFlag(raw: string) {
  if (raw === "" || raw.toLowerCase() === "false") return false;
  return raw.toLowerCase() === "true" ? true : null;
}

function parseAlternates(raw: string, sku: string) {
  const codes = new Set<string>();
  if (raw) {
    const choices = raw.split("|");
    if (choices.length > maxAlternates) return null;
    for (const choice of choices) {
      const code = selector(choice);
      if (code === null || code === sku || codes.has(code)) return null;
      codes.add(code);
    }
  }
  return [...codes];
}

function extendedRow(line: string, headers: string[]): Result<ReleaseBomEntry, string> {
  const row = cells(line);
  if (row === null || row.length !== headers.length) return err("match the CSV header.");
  const read = (key: string) => row[headers.indexOf(key)] ?? "";
  const sku = selector(read("sku"));
  const enteredQuantity = read("quantity");
  const quantity = Number(enteredQuantity);
  const unit = parseUnit(read("unit"));
  if (sku === null) return err("use an exact SKU or a part code with its catalog revision.");
  if (
    !decimalQuantity.test(enteredQuantity) ||
    quantity <= 0 ||
    quantity > 1_000_000 ||
    unit === undefined ||
    (unit === null && !Number.isInteger(quantity))
  ) {
    return err("enter a positive quantity up to 1000000 and a recognized unit for fractions.");
  }
  const childRelease = read("child_release").toUpperCase() || null;
  if (childRelease !== null && !releasePattern.test(childRelease))
    return err("use a valid manufacturing release revision.");
  const alternateSkus = parseAlternates(read("alternates"), sku);
  if (alternateSkus === null) return err("use up to eight distinct alternate part selectors.");
  const optional = parseFlag(read("optional"));
  const consumable = parseFlag(read("consumable"));
  const inherited = parseFlag(read("inherited"));
  if (optional === null || consumable === null || inherited === null)
    return err("use true, false or a blank cell for flags.");
  const piecesText = read("pieces");
  const pieces = piecesText === "" ? null : Number(piecesText);
  if (pieces !== null && (!wholeQuantity.test(piecesText) || pieces > 1_000_000))
    return err("enter a whole piece count up to 1000000.");
  if (inherited && childRelease === null) return err("pin a release for inherited lines.");
  if (childRelease !== null && (pieces !== null || alternateSkus.length > 0 || consumable))
    return err("piece counts, consumable flags and alternates apply to leaf materials.");

  return ok({
    sku,
    quantity,
    details: {
      enteredQuantity,
      unit,
      childRelease,
      alternateSkus,
      optional,
      consumable,
      inherited,
      pieces,
    },
  });
}

export function inspectReleaseBom(bytes: Uint8Array): Result<ReleaseBomEntry[], string> {
  if (bytes.byteLength > releaseBomMaxBytes) return err("Use a BOM CSV of at most 64 KiB.");
  let text: string;
  try {
    text = utf8.decode(bytes);
  } catch {
    return err("Use UTF-8 text for the BOM CSV.");
  }
  // Retain physical line numbers in import diagnostics.
  const lines = text
    .split(/\r\n|\n|\r/)
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => line.trim().length > 0);
  const [first, ...body] = lines;
  const headers = cells(first?.line ?? "")?.map((cell) => cell.toLowerCase());
  if (
    headers === undefined ||
    headers[0] !== "sku" ||
    headers[1] !== "quantity" ||
    new Set(headers).size !== headers.length ||
    headers.slice(2).some((column) => !extras.has(column))
  ) {
    return err("Start the BOM CSV with sku and quantity followed by supported BOM columns.");
  }
  if (body.length === 0 || body.length > maxRows)
    return err("Use between 1 and 30 distinct BOM rows.");
  const seen = new Set<string>();
  const bom: ReleaseBomEntry[] = [];
  for (const { line, number } of body) {
    const parsed = headers.length > 2 ? extendedRow(line, headers) : ok(legacyRow(line));
    if (!parsed.ok) return err(`BOM row ${number} must ${parsed.error}`);
    if (parsed.value === null)
      return err(`BOM row ${number} must contain an SKU and a whole quantity up to 1000000.`);
    if (seen.has(parsed.value.sku)) return err(`BOM row ${number} repeats a material selector.`);
    seen.add(parsed.value.sku);
    bom.push(parsed.value);
  }
  return ok(bom);
}

export function parseReleaseBom(bytes: Uint8Array): ReleaseBomEntry[] | null {
  const parsed = inspectReleaseBom(bytes);
  return parsed.ok ? parsed.value : null;
}
