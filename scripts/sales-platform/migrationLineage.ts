import { createHash } from "node:crypto";
import { readdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { err, ok } from "../../src/types/result";
import {
  type CheckoutInput,
  checkoutInput,
  decodeJson,
  type InspectionResult,
  JSON_LIMIT,
  journalSchema,
  MAX_MIGRATIONS,
  readBounded,
  SQL_LIMIT,
} from "./migrationInput";
import { inspectLedger, type LedgerEvidence } from "./migrationLedger";

export type MigrationEntry = {
  idx: number;
  tag: string;
  when: number;
  sha256: string;
  bytes: number;
};
export type MigrationInventory = {
  label: string;
  directory: string;
  journalSha256: string;
  entries: MigrationEntry[];
  ledger: LedgerEvidence;
  qualifiesUpgrade: false;
};
export type LineageComparison = {
  left: string;
  right: string;
  sharedPrefix: number;
  relation: "identical" | "left-extends" | "right-extends" | "divergent";
  mismatch?: { index: number; fields: string[] };
};
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

async function inventorySource(
  input: CheckoutInput,
  signal: AbortSignal,
): Promise<InspectionResult<Omit<MigrationInventory, "ledger" | "qualifiesUpgrade">>> {
  let directory: string;
  try {
    directory = await realpath(input.directory);
  } catch {
    signal.throwIfAborted();
    return err({ code: "unreadable-checkout" });
  }
  const journal = await readBounded("drizzle/meta/_journal.json", JSON_LIMIT, signal, directory);
  if (!journal.ok) return journal;
  const json = decodeJson(journal.value, "invalid-journal");
  if (!json.ok) return json;
  const parsed = journalSchema.safeParse(json.value);
  if (!parsed.success) return err({ code: "invalid-journal" });
  const entries: MigrationEntry[] = [];
  for (const entry of parsed.data.entries) {
    const sql = await readBounded(`drizzle/${entry.tag}.sql`, SQL_LIMIT, signal, directory);
    if (!sql.ok) return sql;
    entries.push({
      idx: entry.idx,
      tag: entry.tag,
      when: entry.when,
      sha256: sha256(sql.value),
      bytes: sql.value.length,
    });
  }
  try {
    const files = await readdir(join(directory, "drizzle"));
    signal.throwIfAborted();
    if (files.length > MAX_MIGRATIONS * 2) return err({ code: "directory-limit" });
    const journaled = new Set(entries.map((entry) => `${entry.tag}.sql`));
    if (files.some((file) => file.endsWith(".sql") && !journaled.has(file)))
      return err({ code: "unjournaled-sql" });
  } catch {
    signal.throwIfAborted();
    return err({ code: "unreadable-migrations-directory" });
  }
  return ok({ label: input.label, directory, journalSha256: sha256(journal.value), entries });
}

export async function inspectCheckout(
  input: unknown,
  signal: AbortSignal,
): Promise<InspectionResult<MigrationInventory>> {
  signal.throwIfAborted();
  const parsed = checkoutInput.safeParse(input);
  if (!parsed.success) return err({ code: "invalid-input" });
  const source = await inventorySource(parsed.data, signal);
  if (!source.ok) return source;
  const ledger = await inspectLedger(parsed.data.ledgerFile, source.value.entries, signal);
  if (!ledger.ok) return ledger;
  return ok({ ...source.value, ledger: ledger.value, qualifiesUpgrade: false });
}

function compare(left: MigrationInventory, right: MigrationInventory): LineageComparison {
  let sharedPrefix = 0;
  const keys = ["idx", "tag", "when", "sha256"] as const;
  for (const [index, entry] of left.entries.entries()) {
    const other = right.entries[index];
    if (other === undefined) break;
    const fields = keys.filter((key) => entry[key] !== other[key]);
    if (fields.length > 0)
      return {
        left: left.label,
        right: right.label,
        sharedPrefix,
        relation: "divergent",
        mismatch: { index, fields },
      };
    sharedPrefix++;
  }
  const relation =
    left.entries.length === right.entries.length
      ? "identical"
      : left.entries.length > right.entries.length
        ? "left-extends"
        : "right-extends";
  return { left: left.label, right: right.label, sharedPrefix, relation };
}

export function compareLineages(inventories: MigrationInventory[]): LineageComparison[] {
  return inventories.flatMap((left, index) =>
    inventories.slice(index + 1).map((right) => compare(left, right)),
  );
}
