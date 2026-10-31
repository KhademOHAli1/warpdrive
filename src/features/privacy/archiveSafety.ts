import { z } from "zod";
import { err, ok, type Result } from "@/types/result";

const ARCHIVE_DIRECTORIES = ["records", "attachments", "email"] as const;
const MAX_FILENAME_BYTES = 200;
const MAX_ARCHIVE_ENTRIES = 10_000;
const MAX_CSV_CELL_LENGTH = 1_048_576;
const UTF8 = new TextEncoder();
const CONTROL_OR_LINE_SEPARATOR = /[\p{Cc}\p{Zl}\p{Zp}]/u;
const BIDI_CONTROL = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
const FORBIDDEN_FILENAME_CHARACTER = /[<>:"/\\|?*]/u;
const ENCODED_BYTE = /%[0-9a-f]{2}/iu;
const WINDOWS_DEVICE = /^(?:con(?:in\$|out\$)?|prn|aux|nul|com[1-9]|lpt[1-9])$/iu;
const FORMULA_PREFIX = /^[\s\p{Cf}]*[=+\-@]/u;

const archivePathInputSchema = z
  .object({
    directory: z.enum(ARCHIVE_DIRECTORIES),
    recordId: z.uuid(),
    filename: z.string().min(1).max(MAX_FILENAME_BYTES),
  })
  .strict();
const archivePathsSchema = z.array(z.string()).max(MAX_ARCHIVE_ENTRIES);
const csvCellSchema = z.string().max(MAX_CSV_CELL_LENGTH);
type ArchiveFailure = "invalid_archive_path" | "archive_path_collision";

function hasLoneSurrogate(value: string): boolean {
  for (const character of value) {
    const point = character.codePointAt(0);
    if (point !== undefined && point >= 0xd800 && point <= 0xdfff) return true;
  }
  return false;
}

function validFilename(filename: string): boolean {
  const compatible = filename.normalize("NFKC");
  const stem = compatible.split(".")[0]?.trimEnd() ?? "";
  return (
    UTF8.encode(filename).length <= MAX_FILENAME_BYTES &&
    !hasLoneSurrogate(filename) &&
    !CONTROL_OR_LINE_SEPARATOR.test(filename) &&
    !BIDI_CONTROL.test(filename) &&
    !FORBIDDEN_FILENAME_CHARACTER.test(compatible) &&
    !ENCODED_BYTE.test(compatible) &&
    !compatible.startsWith(".") &&
    !compatible.endsWith(".") &&
    compatible.trim() === compatible &&
    !WINDOWS_DEVICE.test(stem)
  );
}

// Rejecting unsafe names avoids replacement collisions and preserves their original text for separate review.
export function buildPrivacyArchivePath(input: unknown): Result<string, "invalid_archive_path"> {
  const parsed = archivePathInputSchema.safeParse(input);
  if (!parsed.success) return err("invalid_archive_path");
  const filename = parsed.data.filename.normalize("NFC");
  if (!validFilename(filename)) return err("invalid_archive_path");
  return ok(`${parsed.data.directory}/${parsed.data.recordId.toLowerCase()}/${filename}`);
}

export function validatePrivacyArchivePaths(input: unknown): Result<string[], ArchiveFailure> {
  const parsed = archivePathsSchema.safeParse(input);
  if (!parsed.success) return err("invalid_archive_path");
  const keys = new Set<string>();
  const paths: string[] = [];
  for (const path of parsed.data) {
    const parts = path.split("/");
    if (parts.length !== 3) return err("invalid_archive_path");
    const checked = buildPrivacyArchivePath({
      directory: parts[0],
      recordId: parts[1],
      filename: parts[2],
    });
    if (!checked.ok) return checked;
    // Some extractors normalize compatibility characters and compare names without case.
    const key = checked.value.normalize("NFKC").toUpperCase().toLowerCase();
    if (keys.has(key)) return err("archive_path_collision");
    keys.add(key);
    paths.push(checked.value);
  }
  return ok(paths);
}

export function escapePrivacyCsvCell(input: unknown): Result<string, "invalid_csv_cell"> {
  const parsed = csvCellSchema.safeParse(input);
  if (!parsed.success || hasLoneSurrogate(parsed.data)) return err("invalid_csv_cell");
  const cell = parsed.data;
  if (/\p{Cc}/u.test(cell.replace(/[\t\r\n]/gu, ""))) return err("invalid_csv_cell");
  const protectedCell = FORMULA_PREFIX.test(cell) ? `'${cell}` : cell;
  return ok(`"${protectedCell.replace(/"/gu, '""')}"`);
}
