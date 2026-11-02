// Operational bounds for one complete, atomically published account catalog.
export const MAX_CATALOG_ENTRY_BYTES = 64 * 1024;
export const MAX_CATALOG_ENTRIES = 10_000;
export const MAX_CATALOG_BYTES = 16 * 1024 * 1024;
const MAX_JSON_DEPTH = 32;
const encoder = new TextEncoder();

function safeText(value: string): boolean {
  if (value.includes("\u0000")) return false;
  for (const character of value) {
    const point = character.codePointAt(0);
    if (point !== undefined && point >= 0xd800 && point <= 0xdfff) return false;
  }
  return true;
}

function safeJson(value: unknown, depth: number): boolean {
  if (depth > MAX_JSON_DEPTH) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "string") return safeText(value);
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item: unknown) => safeJson(item, depth + 1));
  if (typeof value !== "object") return false;
  return Object.entries(value).every(([key, item]) => safeText(key) && safeJson(item, depth + 1));
}

export function catalogJsonBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).byteLength;
}

// PostgreSQL jsonb cannot represent NUL or broken surrogate pairs. Check the full
// loose provider payload so a future field cannot fail halfway through publication.
export function calendarEntryFitsStorage(value: unknown): boolean {
  return safeJson(value, 0) && catalogJsonBytes(value) <= MAX_CATALOG_ENTRY_BYTES;
}
