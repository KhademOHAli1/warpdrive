import { z } from "zod";
import { err, ok, type Result } from "@/types/result";

const journalEntrySchema = z.strictObject({
  idx: z.number().int().nonnegative().safe(),
  version: z.literal("7"),
  when: z.number().int().positive().safe(),
  tag: z.string().regex(/^\d{4}_[a-z0-9_]+$/u),
  breakpoints: z.boolean(),
});
const journalSchema = z.strictObject({
  version: z.literal("7"),
  dialect: z.literal("postgresql"),
  entries: z.array(journalEntrySchema).min(1),
});
export type MigrationJournalEntry = z.infer<typeof journalEntrySchema>;
export type CanonicalMigration = MigrationJournalEntry & { hash: string; sql: string[] };

export function parseMigrationJournal(raw: unknown): Result<MigrationJournalEntry[], string> {
  const parsed = journalSchema.safeParse(raw);
  if (!parsed.success) return err("invalid canonical migration journal");
  let previousTime = 0;
  for (const [position, entry] of parsed.data.entries.entries()) {
    if (
      entry.idx !== position ||
      !entry.tag.startsWith(`${String(position).padStart(4, "0")}_`) ||
      entry.when <= previousTime
    )
      return err("unordered canonical migration journal");
    previousTime = entry.when;
  }
  return ok(parsed.data.entries);
}

const ledgerSchema = z.array(
  z.strictObject({
    id: z.number().int().positive().safe(),
    hash: z.string().regex(/^[a-f0-9]{64}$/u),
    created_at: z.string().regex(/^\d+$/u),
  }),
);

// IDs may contain legitimate sequence gaps; missing canonical migrations may not.
export function validateMigrationLedger(
  canonical: readonly CanonicalMigration[],
  raw: unknown,
): Result<number, string> {
  const parsed = ledgerSchema.safeParse(raw);
  if (!parsed.success) return err("invalid migration ledger");
  let previousId = 0;
  for (const [position, row] of parsed.data.entries()) {
    const expected = canonical[position];
    if (
      expected === undefined ||
      row.id <= previousId ||
      row.hash !== expected.hash ||
      row.created_at !== String(expected.when)
    )
      return err("unsupported migration history: expected an exact canonical prefix");
    previousId = row.id;
  }
  return ok(parsed.data.length);
}
