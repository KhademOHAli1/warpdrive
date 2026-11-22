import { z } from "zod";
import type { AssetTagImportEntry } from "./contracts";
import { splitTagUrl, tagOrigin } from "./tagCodes";

const shelfShortenerOrigin = "https://eam.sh";
const selfHostedQrPath = "/qr/";
const maxIdentifierLength = 400;
const maxCsvLength = 64 * 1_024;
const maxCsvEntries = 100;
const headers = ["identifier", "target_kind", "target_id"] as const;
const validateTargetId = z.uuid().toLowerCase();

// Pinned Shelf uses lower-case CUID2 IDs and requires a digit in each QR ID.
const shelfId = /^(?=[a-z0-9]*\d)[a-z][a-z0-9]{6,23}$/;

export type LegacyTagIdentifier = { id: string; origin: string | null };
export type LegacyTagImportRow = AssetTagImportEntry & { row: number };
export type LegacyTagCsvError = {
  row: number;
  error:
    | "header"
    | "empty"
    | "limit"
    | "malformed"
    | "identifier"
    | "target_kind"
    | "target_id"
    | "duplicate_identifier"
    | "duplicate_target";
};
export type LegacyTagCsvPreview =
  | { ok: true; rows: LegacyTagImportRow[] }
  | { ok: false; errors: LegacyTagCsvError[] };

function idFromUrl(
  { origin, path }: NonNullable<ReturnType<typeof splitTagUrl>>,
  approvedOrigin: string | null | undefined,
): string | null {
  if (origin === shelfShortenerOrigin) return path.slice(1);
  if (approvedOrigin == null || origin !== tagOrigin(approvedOrigin)) return null;
  if (!path.startsWith(selfHostedQrPath)) return null;
  return path.slice(selfHostedQrPath.length);
}

export function parseLegacyTagIdentifier(
  value: string,
  approvedOrigin?: string | null,
): LegacyTagIdentifier | null {
  if (value.length > maxIdentifierLength) return null;
  const raw = value.replace(/^\]Q[012]/, "").replace(/[\r\n]+$/, "");
  if (shelfId.test(raw) && !/[\s\p{Cc}]/u.test(raw)) return { id: raw, origin: null };
  const link = splitTagUrl(raw);
  if (link === null) return null;
  const id = idFromUrl(link, approvedOrigin);
  return id !== null && shelfId.test(id) ? { id, origin: link.origin } : null;
}

type PhysicalLine = { line: string; row: number };
type PreviewedRow =
  | { entry: LegacyTagImportRow; legacyId: string }
  | { errors: LegacyTagCsvError[] };

// All three fields are identifiers. Each record occupies one physical line even when quoted.
const field = /([ \t]*"(?:[^"]|"")*"[ \t]*|[^",]*)/.source;
const threeColumns = new RegExp(`^${field},${field},${field}$`, "u");

function unquote(raw: string) {
  const value = raw.trim();
  return value.startsWith('"') ? value.slice(1, -1).replaceAll('""', '"').trim() : value;
}

function columns(line: string): [string, string, string] | null {
  if (line.length > 3 * maxIdentifierLength) return null;
  const match = threeColumns.exec(line.trim());
  if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) return null;
  return [unquote(match[1]), unquote(match[2]), unquote(match[3])];
}

function previewRow({ line, row }: PhysicalLine, approvedOrigin?: string | null): PreviewedRow {
  const cells = columns(line);
  if (cells === null) return { errors: [{ row, error: "malformed" }] };
  const [identifier, kind, rawId] = cells;
  const legacy = parseLegacyTagIdentifier(identifier, approvedOrigin);
  const targetId = validateTargetId.safeParse(rawId);
  const knownKind = kind === "asset" || kind === "kit";
  if (legacy !== null && knownKind && targetId.success) {
    return { entry: { row, identifier, target: { id: targetId.data, kind } }, legacyId: legacy.id };
  }
  const errors: LegacyTagCsvError[] = [];
  if (legacy === null) errors.push({ row, error: "identifier" });
  if (!knownKind) errors.push({ row, error: "target_kind" });
  if (!targetId.success) errors.push({ row, error: "target_id" });
  return { errors };
}

function previewRows(body: PhysicalLine[], approvedOrigin?: string | null): LegacyTagCsvPreview {
  const rows: LegacyTagImportRow[] = [];
  const errors: LegacyTagCsvError[] = [];
  const aliases = new Set<string>();
  const targets = new Set<string>();
  for (const line of body) {
    const previewed = previewRow(line, approvedOrigin);
    if ("errors" in previewed) {
      errors.push(...previewed.errors);
      continue;
    }
    const { entry, legacyId } = previewed;
    const key = `${entry.target.kind}:${entry.target.id}`;
    if (aliases.has(legacyId)) errors.push({ row: entry.row, error: "duplicate_identifier" });
    if (targets.has(key)) errors.push({ row: entry.row, error: "duplicate_target" });
    aliases.add(legacyId);
    targets.add(key);
    rows.push(entry);
  }
  return errors.length === 0 ? { ok: true, rows } : { ok: false, errors };
}

export function previewLegacyTagCsv(
  raw: string,
  approvedOrigin?: string | null,
): LegacyTagCsvPreview {
  if (raw.length > maxCsvLength) return { ok: false, errors: [{ row: 1, error: "limit" }] };
  const [header, ...body] = raw
    .replace(/^\uFEFF/, "")
    .split(/\r\n|\n|\r/)
    .map((line, index) => ({ line, row: index + 1 }))
    .filter(({ line }) => line.trim() !== "");
  if (header === undefined) return { ok: false, errors: [{ row: 1, error: "empty" }] };
  const headerCells = columns(header.line);
  if (headers.some((headerName, index) => headerCells?.[index] !== headerName)) {
    return { ok: false, errors: [{ row: header.row, error: "header" }] };
  }
  if (body.length === 0) return { ok: false, errors: [{ row: header.row + 1, error: "empty" }] };
  const overflow = body[maxCsvEntries];
  if (overflow !== undefined) return { ok: false, errors: [{ row: overflow.row, error: "limit" }] };
  return previewRows(body, approvedOrigin);
}
