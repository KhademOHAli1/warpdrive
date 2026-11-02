import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { err, ok, type Result } from "../../src/types/result";
import type { CheckoutInput } from "./migrationInput";
import { compareLineages, inspectCheckout } from "./migrationLineage";

const USAGE =
  "bun scripts/sales-platform/check-migration-lineage.ts --checkout LABEL=DIR " +
  "[--checkout LABEL=DIR ...] [--ledger LABEL=FILE ...]";
const EVIDENCE_CEILING =
  "Read-only source and supplied-export comparison. No database was " +
  "queried, no migration was run, and upgrade, restore and provider behavior remain unqualified.";

function parseArguments(args: string[]): Result<CheckoutInput[], "invalid-cli-arguments"> {
  if (args.length === 0 || args.length > 32 || args.length % 2 !== 0)
    return err("invalid-cli-arguments");
  const roots = new Map<string, string>();
  const ledgers = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1] ?? "";
    const separator = value.indexOf("=");
    const label = value.slice(0, separator);
    const path = value.slice(separator + 1);
    if (separator < 1 || !/^[a-z][a-z0-9_-]{0,31}$/.test(label) || path.length === 0)
      return err("invalid-cli-arguments");
    if (option !== "--checkout" && option !== "--ledger") return err("invalid-cli-arguments");
    const map = option === "--checkout" ? roots : ledgers;
    if (map.has(label)) return err("invalid-cli-arguments");
    map.set(label, path);
  }
  if (roots.size === 0 || roots.size > 8 || [...ledgers.keys()].some((label) => !roots.has(label)))
    return err("invalid-cli-arguments");
  return ok(
    [...roots].map(([label, directory]) => ({
      label,
      directory,
      ledgerFile: ledgers.get(label),
    })),
  );
}

export async function runLineageInspection(
  args: string[],
  signal: AbortSignal,
): Promise<{ exitCode: 0 | 1 | 2; output: unknown }> {
  if (args.length === 1 && args[0] === "--help") return { exitCode: 0, output: { usage: USAGE } };
  const parsed = parseArguments(args);
  if (!parsed.ok) return { exitCode: 1, output: { status: parsed.error, usage: USAGE } };
  const inspections = await Promise.all(
    parsed.value.map((input) => inspectCheckout(input, signal)),
  );
  const inventories = inspections.flatMap((result) => (result.ok ? [result.value] : []));
  const comparisons = compareLineages(inventories);
  const invalid =
    inspections.some((result) => !result.ok) ||
    inventories.some((inventory) => inventory.ledger.status === "mismatch") ||
    comparisons.some((comparison) => comparison.relation === "divergent");
  const missing = inventories.some((inventory) => inventory.ledger.status === "not-provided");
  return {
    exitCode: invalid ? 1 : missing ? 2 : 0,
    output: {
      qualifiesUpgrade: false,
      evidenceCeiling: EVIDENCE_CEILING,
      inspections,
      comparisons,
    },
  };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await runLineageInspection(process.argv.slice(2), AbortSignal.timeout(30_000));
    process.stdout.write(`${JSON.stringify(result.output, null, 2)}\n`);
    process.exitCode = result.exitCode;
  } catch {
    process.stderr.write(
      "Migration inspection cancelled or interrupted; no database was accessed.\n",
    );
    process.exitCode = 1;
  }
}
