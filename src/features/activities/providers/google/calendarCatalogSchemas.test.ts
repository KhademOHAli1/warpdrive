import { expect, it } from "vitest";
import { calendarEntrySchema } from "./schemas";

// These are Warpdrive catalog storage bounds, not Google API limits.
const MAX_ENTRY_BYTES = 64 * 1024;
function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

it("preserves opaque identity, RTL display data and unknown conference metadata", () => {
  const input = {
    id: "team/+?=#%/e\u0301@example.invalid",
    summary: "تقویم گروه / Termine",
    summaryOverride: "عنوان شخصی",
    etag: '"calendar-revision-1"',
    hidden: true,
    accessRole: "writerWithoutPrivateAccess",
    conferenceProperties: {
      allowedConferenceSolutionTypes: ["hangoutsMeet"],
      vendorMetadata: { label: "جلسه", options: [false, null, 3] },
    },
    vendorMetadata: { nested: { label: "تهران / Berlin" } },
  };
  const parsed = calendarEntrySchema.safeParse(input);
  expect(parsed.success).toBe(true);
  if (parsed.success) expect(parsed.data).toEqual(input);
});

it.each([
  { field: "hidden", value: "true" },
  { field: "summaryOverride", value: { text: "not a string" } },
  { field: "etag", value: "" },
])("rejects invalid typed $field metadata", ({ field, value }) => {
  expect(calendarEntrySchema.safeParse({ id: "opaque-id", [field]: value }).success).toBe(false);
});

it.each(["id", "summary"])(
  "rejects NUL in %s instead of normalizing away identity or display data",
  (field) => {
    const input = { id: "opaque-id", [field]: "before\u0000after" };
    expect(calendarEntrySchema.safeParse(input).success).toBe(false);
  },
);

it.each([
  { path: "unknown key", raw: { "before\u0000after": "value" } },
  { path: "unknown value", raw: { nested: [{ label: "before\u0000after" }] } },
])("rejects PostgreSQL-incompatible NUL in a nested $path", ({ raw }) => {
  expect(calendarEntrySchema.safeParse({ id: "opaque-id", vendorMetadata: raw }).success).toBe(
    false,
  );
});

it.each([
  { path: "unknown key", raw: { "broken\ud800": "value" } },
  { path: "unknown value", raw: { nested: [{ label: "broken\ud800" }] } },
])("rejects an unpaired Unicode surrogate in a nested $path", ({ raw }) => {
  expect(calendarEntrySchema.safeParse({ id: "opaque-id", vendorMetadata: raw }).success).toBe(
    false,
  );
});

it("rejects a nonfinite number produced by overflowing provider JSON", () => {
  const input: unknown = JSON.parse('{"id":"opaque-id","vendorMetadata":{"number":1e999}}');
  expect(calendarEntrySchema.safeParse(input).success).toBe(false);
});

it("rejects unknown JSON nested deeper than the catalog's 32-level operational bound", () => {
  let nested: unknown = "leaf";
  for (let depth = 0; depth < 33; depth++) nested = depth % 2 === 0 ? { next: nested } : [nested];
  const input = { id: "opaque-id", vendorMetadata: nested };
  expect(jsonBytes(input)).toBeLessThan(MAX_ENTRY_BYTES);
  expect(calendarEntrySchema.safeParse(input).success).toBe(false);
});

it("accepts a JSON entry at the inclusive 64 KiB storage bound", () => {
  const base = { id: "opaque-id", vendorMetadata: "" };
  const input = { ...base, vendorMetadata: "x".repeat(MAX_ENTRY_BYTES - jsonBytes(base)) };
  expect(jsonBytes(input)).toBe(MAX_ENTRY_BYTES);
  expect(calendarEntrySchema.safeParse(input).success).toBe(true);
});

it("measures the 64 KiB entry bound in UTF-8 bytes, including unknown Unicode metadata", () => {
  const input = { id: "opaque-id", vendorMetadata: "😀".repeat(MAX_ENTRY_BYTES / 4) };
  expect(JSON.stringify(input).length).toBeLessThan(MAX_ENTRY_BYTES);
  expect(jsonBytes(input)).toBeGreaterThan(MAX_ENTRY_BYTES);
  expect(calendarEntrySchema.safeParse(input).success).toBe(false);
});
