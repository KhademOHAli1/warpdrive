import { ok } from "../../src/types/result";
import {
  decodeJson,
  type InspectionResult,
  JSON_LIMIT,
  type LedgerRow,
  ledgerSchema,
  readBounded,
} from "./migrationInput";
import type { MigrationEntry } from "./migrationLineage";

export type LedgerEvidence = {
  status: "not-provided" | "matching-prefix" | "mismatch";
  issues: string[];
  appliedCount?: number;
  pendingCount?: number;
};

function identityIssues(rows: LedgerRow[]): string[] {
  const issues = new Set<string>();
  const timestamps = new Set<number>();
  const ids = new Set<number>();
  for (const [index, row] of rows.entries()) {
    if (timestamps.has(row.created_at)) issues.add("duplicate-ledger-timestamp");
    timestamps.add(row.created_at);
    if (row.id !== undefined) {
      if (ids.has(row.id)) issues.add("duplicate-ledger-id");
      ids.add(row.id);
    }
    const previous = rows[index - 1];
    if (previous !== undefined && row.created_at <= previous.created_at)
      issues.add("out-of-order-ledger");
  }
  return [...issues];
}

function rowIssues(rows: LedgerRow[], entries: MigrationEntry[]): string[] {
  const issues = new Set(identityIssues(rows));
  for (const [index, row] of rows.entries()) {
    const byTime = entries.find((entry) => entry.when === row.created_at);
    const byHash = entries.find((entry) => entry.sha256 === row.hash);
    if (byTime !== undefined && byTime.sha256 !== row.hash)
      issues.add("hash-mismatch-at-timestamp");
    else if (byTime === undefined && byHash !== undefined) issues.add("timestamp-mismatch");
    else if (byTime === undefined) issues.add("unknown-applied-migration");
    const expected = entries[index];
    if (expected?.when !== row.created_at || expected.sha256 !== row.hash)
      issues.add("non-prefix-ledger");
  }
  return [...issues];
}

export async function inspectLedger(
  file: string | undefined,
  entries: MigrationEntry[],
  signal: AbortSignal,
): Promise<InspectionResult<LedgerEvidence>> {
  if (file === undefined) return ok({ status: "not-provided", issues: [] });
  const bytes = await readBounded(file, JSON_LIMIT, signal);
  if (!bytes.ok) return bytes;
  const json = decodeJson(bytes.value, "invalid-ledger");
  if (!json.ok) return json;
  const parsed = ledgerSchema.safeParse(json.value);
  if (!parsed.success) return { ok: false, error: { code: "invalid-ledger" } };
  const issues = rowIssues(parsed.data.rows, entries);
  return ok({
    status: issues.length === 0 ? "matching-prefix" : "mismatch",
    appliedCount: parsed.data.rows.length,
    pendingCount: Math.max(0, entries.length - parsed.data.rows.length),
    issues,
  });
}
