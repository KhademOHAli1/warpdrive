import { build } from "esbuild";
import { isAbsolute } from "node:path";
import { buildOptionsForEntry } from "./build-workers.mjs";

const args = process.argv.slice(2);
const [flag, output] = args;
if (args.length !== 0 && (args.length !== 2 || flag !== "--output" || !isAbsolute(output))) {
  throw new Error("Expected --output with an absolute output path");
}

await build(
  buildOptionsForEntry({
    in: "src/entrypoints/operations-collector.ts",
    out: output ?? "dist/operations-collector.mjs",
  }),
);
