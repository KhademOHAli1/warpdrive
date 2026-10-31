import { build } from "esbuild";

// Transpile + bundle ONLY our own source (the `@/*` graph) for the server entrypoints into
// one file each, resolving npm packages at runtime from node_modules (packages: "external"). We
// deliberately do NOT inline node_modules: deps like jsdom (via isomorphic-dompurify) read their
// own data files with a __dirname-relative readFileSync, which breaks the moment they are bundled.
// The Docker runtime ships a prod-only node_modules for these external requires to resolve against.
// Output is .mjs so the bundled workers have an explicit ESM format.
const entries = [
  { in: "src/entrypoints/ws.ts", out: "dist/ws.mjs" },
  { in: "src/entrypoints/worker.ts", out: "dist/worker.mjs" },
  { in: "src/entrypoints/migrate.ts", out: "dist/migrate.mjs" },
  { in: "src/entrypoints/sweepSpam.ts", out: "dist/sweep-spam.mjs" },
  { in: "scripts/auth-operator.ts", out: "dist/auth-operator.mjs" },
];

await Promise.all(
  entries.map((entry) =>
    build({
      entryPoints: [entry.in],
      outfile: entry.out,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
      packages: "external",
      logLevel: "info",
    }),
  ),
);
