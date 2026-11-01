import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { commitSchema } from "./mail-migration-git";
import { prepareMailMigrationReconciliation } from "./mail-migration-plan";
import { writeMailMigrationCandidate } from "./mail-migration-write";

const argumentsSchema = z.object({
  root: z.string().min(1),
  platform: commitSchema,
  mail: commitSchema,
  write: z.boolean().optional(),
});

async function main(signal: AbortSignal): Promise<void> {
  try {
    const raw = parseArgs({
      args: process.argv.slice(2),
      options: {
        root: { type: "string" },
        platform: { type: "string" },
        mail: { type: "string" },
        write: { type: "boolean" },
      },
    });
    const parsed = argumentsSchema.safeParse(raw.values);
    if (!parsed.success) {
      process.stderr.write(
        "Expected --root, --platform <40-character commit>, --mail <40-character commit>, optional --write.\n",
      );
      process.exitCode = 1;
      return;
    }
    const plan = await prepareMailMigrationReconciliation({
      root: resolve(parsed.data.root),
      platformRef: parsed.data.platform,
      mailRef: parsed.data.mail,
      signal,
    });
    if (!plan.ok) {
      process.stderr.write(`${JSON.stringify(plan.error)}\n`);
      process.exitCode = 1;
      return;
    }
    if (parsed.data.write === true) {
      const written = await writeMailMigrationCandidate(plan.value, signal);
      if (!written.ok) {
        process.stderr.write(`${JSON.stringify(written.error)}\n`);
        process.exitCode = 1;
        return;
      }
    }
    process.stdout.write(
      `${JSON.stringify({ mode: parsed.data.write === true ? "written" : "read-only", baselineHash: plan.value.baselineHash, conflicts: 0, stages: plan.value.stages })}\n`,
    );
  } catch {
    signal.throwIfAborted();
    process.stderr.write(
      "Migration reconciliation could not complete. No Git staging or commit was performed.\n",
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main(AbortSignal.timeout(30_000));
