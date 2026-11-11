import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Transpile + bundle ONLY our own source (the `@/*` graph) for the server entrypoints into
// one file each, resolving npm packages at runtime from node_modules (packages: "external"). We
// deliberately do NOT inline node_modules: deps like jsdom (via isomorphic-dompurify) read their
// own data files with a __dirname-relative readFileSync, which breaks the moment they are bundled.
// The Docker runtime ships a prod-only node_modules for these external requires to resolve against.
// Output is .mjs so the bundled workers have an explicit ESM format.
const entries = [
  // Production loads this without a source checkout or Next's TS require hook.
  { in: "next.config.ts", out: "dist/next.config.mjs" },
  { in: "src/features/workflows/v2/codeWorker.ts", out: "dist/workflow-code-worker.mjs" },
  { in: "src/entrypoints/ws.ts", out: "dist/ws.mjs" },
  { in: "src/entrypoints/worker.ts", out: "dist/worker.mjs" },
  { in: "src/entrypoints/migrate.ts", out: "dist/migrate.mjs" },
  { in: "src/entrypoints/sweepSpam.ts", out: "dist/sweep-spam.mjs" },
  { in: "scripts/auth-operator.ts", out: "dist/auth-operator.mjs" },
];

const componentOutputs = {
  // Browser/SSR requests can run workflow simulations; operator commands remain available
  // in the web image for the existing operator runbooks.
  web: ["next.config", "workflow-code-worker", "sweep-spam", "auth-operator"],
  worker: ["workflow-code-worker", "worker", "sweep-spam"],
  realtime: ["ws"],
  migrator: ["migrate", "auth-operator"],
};

export function selectBuildEntries(component = "all") {
  if (component === "all") return entries.map((entry) => ({ ...entry }));
  if (!Object.hasOwn(componentOutputs, component))
    throw new Error(`Unknown component: ${component}`);
  const outputs = new Set(componentOutputs[component].map((name) => `dist/${name}.mjs`));
  return entries.filter((entry) => outputs.has(entry.out)).map((entry) => ({ ...entry }));
}

export function parseBuildArguments(args) {
  let component = "all";
  let specifiedComponent = false;
  let list = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--component" && !specifiedComponent) {
      if (args[index + 1] === undefined || args[index + 1].startsWith("--"))
        throw new Error("--component requires a component name");
      component = args[index + 1];
      specifiedComponent = true;
      index += 1;
    } else if (args[index] === "--list" && !list) {
      list = true;
    } else {
      throw new Error(`Unknown or repeated argument: ${args[index]}`);
    }
  }
  return { entries: selectBuildEntries(component), list };
}

// Discovery and production compilation deliberately share this complete option set.
export function buildOptionsForEntry(entry, root = process.cwd()) {
  return {
    absWorkingDir: resolve(root),
    entryPoints: [entry.in],
    outfile: entry.out,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    packages: "external",
    preserveSymlinks: true,
    tsconfig: "tsconfig.json",
    logLevel: "info",
  };
}

export async function discoverBuildGraphs(component, { root = process.cwd(), build } = {}) {
  const selected = selectBuildEntries(component);
  const compile = build ?? (await import("esbuild")).build;
  const graphs = [];
  for (const entry of selected) {
    const result = await compile({
      ...buildOptionsForEntry(entry, root),
      metafile: true,
      write: false,
      logLevel: "silent",
    });
    if (!Array.isArray(result.warnings) || result.warnings.length !== 0)
      throw new Error(`Input graph warnings for ${entry.in}`);
    if (result.metafile?.inputs === undefined || Object.keys(result.metafile.inputs).length === 0)
      throw new Error(`Missing input graph for ${entry.in}`);
    graphs.push({ entry, metafile: result.metafile });
  }
  return graphs;
}

async function main() {
  const options = parseBuildArguments(process.argv.slice(2));
  if (options.list) {
    console.log(JSON.stringify(options.entries));
    return;
  }
  // Selection and --list need no installed dependencies and create no build outputs.
  const { build } = await import("esbuild");
  await Promise.all(options.entries.map((entry) => build(buildOptionsForEntry(entry))));
}

if (
  process.argv[1] &&
  realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))
)
  await main();
