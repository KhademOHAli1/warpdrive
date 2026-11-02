// Warpdrive operational limits for one complete provider event-sync result.
export const MAX_EVENT_SYNC_PAGES = 1_000;
export const MAX_EVENT_SYNC_EVENTS = 50_000;
export const MAX_RAW_EVENT_BYTES = 1024 * 1024;
export const MAX_EVENT_SYNC_BYTES = 32 * 1024 * 1024;
export const MAX_EVENT_CURSOR_BYTES = 64 * 1024;
export const MAX_EVENT_PAGE_TOKEN_BYTES = 1024 * 1024;
const MAX_EVENT_JSON_DEPTH = 32;
const encoder = new TextEncoder();

function safeText(value: string): boolean {
  if (value.includes("\u0000")) return false;
  for (const character of value) {
    const point = character.codePointAt(0);
    if (point !== undefined && point >= 0xd800 && point <= 0xdfff) return false;
  }
  return true;
}

export function eventCursorBytes(value: string): number | null {
  if (!safeText(value)) return null;
  const bytes = encoder.encode(value).byteLength;
  return bytes <= MAX_EVENT_CURSOR_BYTES ? bytes : null;
}

function safeJson(value: unknown, depth: number): boolean {
  if (depth > MAX_EVENT_JSON_DEPTH) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "string") return safeText(value);
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item: unknown) => safeJson(item, depth + 1));
  if (typeof value !== "object") return false;
  return Object.entries(value).every(([key, item]) => safeText(key) && safeJson(item, depth + 1));
}

// Check the complete loose payload, including future fields. These are entry
// storage bounds after JSON parsing, not a streaming HTTP response-body limit.
export function eventStorageBytes(value: unknown): number | null {
  if (!safeJson(value, 0)) return null;
  const bytes = encoder.encode(JSON.stringify(value)).byteLength;
  return bytes <= MAX_RAW_EVENT_BYTES ? bytes : null;
}
