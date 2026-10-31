import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { err, ok, type Result } from "../src/types/result";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
const jsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(jsonValue),
    z.record(z.string(), jsonValue),
  ]),
);
export const snapshotSchema = z
  .object({
    id: z.string().uuid(),
    prevId: z.string().uuid(),
    version: z.literal("7"),
    dialect: z.literal("postgresql"),
    tables: z.record(z.string(), jsonValue),
    enums: z.record(z.string(), jsonValue),
    schemas: z.record(z.string(), jsonValue),
    sequences: z.record(z.string(), jsonValue),
    roles: z.record(z.string(), jsonValue),
    policies: z.record(z.string(), jsonValue),
    views: z.record(z.string(), jsonValue),
    _meta: z.record(z.string(), jsonValue),
  })
  .catchall(jsonValue);
export type Snapshot = z.infer<typeof snapshotSchema>;
export const journalEntrySchema = z.object({
  idx: z.number().int().nonnegative(),
  version: z.literal("7"),
  when: z.number().int().safe(),
  tag: z.string().regex(/^\d{4}_[a-z0-9_]+$/),
  breakpoints: z.boolean(),
});
export const journalSchema = z.object({
  version: z.literal("7"),
  dialect: z.literal("postgresql"),
  entries: z.array(journalEntrySchema).min(1),
});
export type JournalEntry = z.infer<typeof journalEntrySchema>;
export type ReconcileFailure = {
  kind: "invalid_snapshot" | "invalid_journal" | "conflict";
  paths: string[];
};

const MISSING = Symbol("missing key");
type MergeValue = JsonValue | typeof MISSING;
function object(value: MergeValue): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeValue(
  base: MergeValue,
  platform: MergeValue,
  mail: MergeValue,
  path: string,
  conflicts: string[],
): MergeValue {
  if (isDeepStrictEqual(platform, base)) return mail;
  if (isDeepStrictEqual(mail, base) || isDeepStrictEqual(platform, mail)) return platform;
  // Competing newly-created objects require explicit review, even if their fields differ.
  if (!object(base) || !object(platform) || !object(mail)) {
    conflicts.push(path);
    return MISSING;
  }
  const merged: Record<string, JsonValue> = {};
  for (const key of [
    ...new Set([...Object.keys(base), ...Object.keys(platform), ...Object.keys(mail)]),
  ].sort()) {
    const value = mergeValue(
      base[key] ?? (key in base ? null : MISSING),
      platform[key] ?? (key in platform ? null : MISSING),
      mail[key] ?? (key in mail ? null : MISSING),
      `${path}/${key}`,
      conflicts,
    );
    if (value !== MISSING) merged[key] = value;
  }
  return merged;
}

export function mergeSnapshot(
  baseInput: unknown,
  platformInput: unknown,
  mailInput: unknown,
  prevId: string,
  id: string,
): Result<Snapshot, ReconcileFailure> {
  const inputs = [baseInput, platformInput, mailInput].map((value) =>
    snapshotSchema.safeParse(value),
  );
  const [base, platform, mail] = inputs;
  if (base?.success !== true || platform?.success !== true || mail?.success !== true)
    return err({ kind: "invalid_snapshot", paths: [] });
  const structural = (snapshot: Snapshot): Record<string, JsonValue> =>
    Object.fromEntries(
      Object.entries(snapshot).filter(([key]) => key !== "id" && key !== "prevId"),
    );
  const conflicts: string[] = [];
  const value = mergeValue(
    structural(base.data),
    structural(platform.data),
    structural(mail.data),
    "",
    conflicts,
  );
  if (conflicts.length > 0) return err({ kind: "conflict", paths: conflicts });
  if (!object(value)) return err({ kind: "invalid_snapshot", paths: [] });
  return ok({ ...value, id, prevId } as Snapshot);
}

export function appendForwardJournal(
  raw: string,
  tags: string[],
): Result<{ text: string; entries: JournalEntry[] }, ReconcileFailure> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return err({ kind: "invalid_journal", paths: [] });
  }
  const parsed = journalSchema.safeParse(decoded);
  const closing = /\n {2}\]\n\}\s*$/.exec(raw);
  if (!parsed.success || closing === null || tags.length === 0)
    return err({ kind: "invalid_journal", paths: [] });
  const last = parsed.data.entries.at(-1);
  if (last === undefined) return err({ kind: "invalid_journal", paths: [] });
  const entries = tags.map((tag, index) => ({
    idx: last.idx + index + 1,
    version: "7" as const,
    when: last.when + index + 1,
    tag,
    breakpoints: true,
  }));
  if (entries.some((entry) => !journalEntrySchema.safeParse(entry).success))
    return err({ kind: "invalid_journal", paths: [] });
  const addition = entries
    .map((entry) =>
      JSON.stringify(entry, null, 2)
        .split("\n")
        .map((line) => `    ${line}`)
        .join("\n"),
    )
    .join(",\n");
  return ok({
    text: `${raw.slice(0, closing.index)},\n${addition}${raw.slice(closing.index)}`,
    entries,
  });
}
