import { resolve } from "node:path";
import { verifyProgramme } from "./programme";

const args = process.argv.slice(2);
if (args.length > 1) {
  process.stderr.write(
    "Usage: bun scripts/sales-platform/programme-check.ts [repository-directory]\n",
  );
  process.exitCode = 2;
} else {
  const result = await verifyProgramme(resolve(args[0] ?? "."), AbortSignal.timeout(30_000));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}
