import assert from "node:assert/strict";
import test from "node:test";
import {
  guardWebInputs,
  WEB_EXCLUSIONS,
  WEB_INPUT_POLICY,
  WEB_SOURCE_RULES,
} from "./web_inputs.mjs";

function fixture(changes = {}) {
  const files = {
    "tsconfig.json": JSON.stringify({
      compilerOptions: { paths: { "@/*": ["./src/*"] }, moduleResolution: "bundler" },
    }),
    "next.config.ts": "export default {};",
    "src/app/globals.css": '@import "tailwindcss";\n' + WEB_SOURCE_RULES.join("\n"),
    "src/app/page.tsx":
      'import {value} from "@/shared"; export default function Page(){return value;}',
    "src/shared.ts": "export const value = 1;",
    "src/helper.ts": "export const helper = 1;",
    ...Object.fromEntries(WEB_EXCLUSIONS.map((path) => [path, "export const privateValue = 1;"])),
    ...changes,
  };
  return {
    files,
    run: (options = {}) =>
      guardWebInputs({
        root: "/fixture",
        files: Object.keys(files),
        read: (path) => {
          if (!(path in files)) throw new Error(`missing ${path}`);
          return Promise.resolve(files[path]);
        },
        helperEntries: [{ in: "src/helper.ts", out: "dist/helper.mjs" }],
        manifest: { dependencies: {} },
        lock: { packages: {} },
        fail: (reason) => {
          throw new Error(reason);
        },
        ...options,
      }),
  };
}

void test("bounded policy keeps app roots, helper edges and CSS while omitting only the exact unreachable paths", async () => {
  const f = fixture({ "src/app/unimported.test.ts": 'import "@/server/worker";' });
  const inputs = await f.run();
  for (const path of [
    "next.config.ts",
    "src/app/page.tsx",
    "src/shared.ts",
    "src/helper.ts",
    "src/app/globals.css",
  ])
    assert.ok(inputs.includes(path), path);
  for (const path of WEB_EXCLUSIONS) assert.ok(!inputs.includes(path), path);
  assert.equal(WEB_EXCLUSIONS.length, 3);
  assert.deepEqual(WEB_INPUT_POLICY.exclusions, WEB_EXCLUSIONS);
  assert.deepEqual(WEB_INPUT_POLICY.sourceRules, WEB_SOURCE_RULES);
});

void test("fresh traversal rejects static, transitive, reexport, type-only and literal dynamic edges to omissions", async () => {
  for (const source of [
    'import "@/server/worker";',
    'export * from "@/features/release/job";',
    'export {privateValue} from "./features/privacy/registryIdsInfrastructure2";',
    'import type {privateValue} from "@/server/worker";',
    'await import("@/features/release/job");',
    'require("./server/worker");',
  ]) {
    const f = fixture({ "src/shared.ts": source });
    await assert.rejects(f.run(), /Web reaches omitted source/u, source);
  }
  const f = fixture();
  await f.run();
  f.files["src/shared.ts"] = 'export * from "@/server/worker";';
  await assert.rejects(f.run(), /Web reaches omitted source/u);
});

void test("all App conventions and optional proxy/instrumentation roots are guarded", async () => {
  for (const name of [
    "src/app/(group)/@slot/(.)detail/page.tsx",
    "src/app/icon2.tsx",
    "src/app/sitemap.ts",
    "src/app/manifest.js",
    "src/app/global-not-found.tsx",
    "src/app/default.tsx",
    "src/proxy.ts",
    "instrumentation.ts",
    "src/instrumentation-client.js",
    "src/middleware.ts",
  ]) {
    await assert.rejects(
      fixture({ [name]: 'import "@/server/worker";' }).run(),
      /Web reaches omitted source/u,
      name,
    );
  }
  await assert.rejects(
    fixture({ "src/helper.ts": 'import "@/server/worker";' }).run(),
    /omitted source/u,
  );
});

void test("unknown module, executable and filesystem loaders reject reuse", async () => {
  for (const source of [
    "const path = '@/server/worker'; await import(path);",
    "const path = './server/worker'; require(path);",
    "const alias = require; alias('./server/worker');",
    'import {readFileSync} from "node:fs"; readFileSync("src/server/worker.ts");',
    'import {Worker as Background} from "node:worker_threads"; new Background(path);',
    'import * as threads from "node:worker_threads"; new threads.Worker(path);',
    'import {createRequire} from "node:module";',
    "new URL('./server/worker.ts', import.meta.url);",
    "eval('opaque');",
    "new Function('opaque');",
    "process.getBuiltinModule('fs');",
    'import "@/missing";',
    'import "#unreviewed";',
    'import "undeclared";',
  ])
    await assert.rejects(
      fixture({ "src/shared.ts": source }).run(),
      /Web omission policy rejected/u,
      source,
    );
});

void test("worker message-only imports remain ordinary shared source inputs", async () => {
  const source =
    'import {parentPort,workerData as input} from "node:worker_threads"; export const value = input; parentPort?.postMessage(value);';
  assert.ok((await fixture({ "src/shared.ts": source }).run()).includes("src/shared.ts"));
});

void test("unsupported configuration and resolver changes fail closed", async () => {
  for (const [name, source] of [
    ["next.config.ts", "export default {pageExtensions:['ts','tsx','mdx']};"],
    ["next.config.mjs", "export default {};"],
    [".babelrc", "{}"],
    ["postcss.config.mjs", 'export default {plugins:{"opaque-plugin":{}}};'],
    ["src/pages/index.tsx", "export default function Page(){}"],
    ["app/page.tsx", "export default function Page(){}"],
    [
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] }, baseUrl: "." } }),
    ],
    [
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: { paths: { "@/*": ["./src/*"] }, moduleSuffixes: [".web", ""] },
      }),
    ],
  ])
    await assert.rejects(fixture({ [name]: source }).run(), /Web omission policy rejected/u, name);
});

void test("Tailwind source rules are independently bound to the exact omission policy", async () => {
  const normal = '@import "tailwindcss";\n' + WEB_SOURCE_RULES.join("\n");
  for (const css of [
    normal.replace(WEB_SOURCE_RULES[0], ""),
    normal + '\n@source "../server/worker.ts";',
    normal + '\n@plugin "unsafe";',
    normal.replace('@import "tailwindcss";', '@import "tailwindcss" source("../..");'),
    normal.replace(WEB_SOURCE_RULES[0], `/* ${WEB_SOURCE_RULES[0]} */`),
    normal + '\n@import "../server/worker.ts";',
  ])
    await assert.rejects(
      fixture({ "src/app/globals.css": css }).run(),
      /Web omission policy rejected/u,
      css,
    );
  // Other applications' inactive styles remain conservative input bytes, not an active Web scan root.
  await fixture({ "site/app/globals.css": '@import "tailwindcss";' }).run();
  await assert.rejects(
    fixture({
      "src/shared.ts": 'import "./nested.css"; export const value = 1;',
      "src/nested.css": '@source "./server/worker.ts";',
    }).run(),
    /unreviewed Tailwind source root/u,
  );
});

void test("relative CSS imports remain in fresh reachability and may not read omitted sources", async () => {
  const f = fixture({
    "src/app/globals.css":
      '@import "tailwindcss";\n@import "../style.css";\n' + WEB_SOURCE_RULES.join("\n"),
    "src/style.css": ".card { color:red; }",
  });
  assert.ok((await f.run()).includes("src/style.css"));
  f.files["src/style.css"] = '@import "./server/worker.ts";';
  await assert.rejects(f.run(), /Web reaches omitted source/u);
});

void test("literal framework/font assets and CSS URLs cannot bypass omitted-source reachability", async () => {
  for (const value of [
    "../server/worker.ts",
    "@/features/release/job.ts",
    "src/features/privacy/registryIdsInfrastructure2.ts",
  ]) {
    await assert.rejects(
      fixture({
        "src/app/page.tsx": `const font = {src:${JSON.stringify(value)}}; export default function Page(){return font.src;}`,
      }).run(),
      /Web reaches omitted source/u,
    );
  }
  await assert.rejects(
    fixture({
      "src/app/globals.css":
        '@import "tailwindcss";\n' +
        WEB_SOURCE_RULES.join("\n") +
        '\n.card { background:url("./../app/../server/worker.ts"); }',
    }).run(),
    /omitted source/u,
  );
});

void test("extensionless and dotted requests traverse competing Next/TS exact and index candidates", async () => {
  for (const changes of [
    { "src/shared.js": 'import "@/server/worker";' },
    { "src/shared/index.js": 'import "@/features/privacy/registryIdsInfrastructure2";' },
    {
      "src/app/page.tsx":
        'import "@/shared.contract"; export default function Page(){return null;}',
      "src/shared.contract.ts": "export const value = 1;",
      "src/shared.contract.js": 'import "@/server/worker";',
    },
  ])
    await assert.rejects(fixture(changes).run(), /Web reaches omitted source/u);
  const f = fixture({ "src/shared.js": "export const javascriptValue = 1;" });
  const seen = await f.run();
  assert.ok(seen.includes("src/shared.ts"));
  assert.ok(seen.includes("src/shared.js"));
});

void test("explicit JavaScript requests cannot silently substitute TypeScript source", async () => {
  for (const extension of [".js", ".mjs", ".cjs"]) {
    const target = extension === ".mjs" ? ".mts" : extension === ".cjs" ? ".cts" : ".ts";
    await assert.rejects(
      fixture({
        "src/app/page.tsx": `import "@/explicit${extension}"; export default function Page(){return null;}`,
        [`src/explicit${target}`]: "export const value = 1;",
      }).run(),
      /explicit JavaScript extension substitution/u,
    );
  }
  assert.ok(
    (
      await fixture({
        "src/app/page.tsx": 'import "@/explicit.js"; export default function Page(){return null;}',
        "src/explicit.js": "export const value = 1;",
      }).run()
    ).includes("src/explicit.js"),
  );
});

void test("reachable nested package mappings and self-reference scopes reject omission admission", async () => {
  for (const config of [
    { browser: { "./index.ts": "../../server/worker.ts" } },
    { exports: { ".": "../../server/worker.ts" } },
    { imports: { "#worker": "../../server/worker.ts" } },
    { main: "../../server/worker.ts" },
    { module: "../../server/worker.ts" },
    { name: "nested-first-party-self-reference" },
    { type: "module" },
    { types: "./index.d.ts" },
    { typings: "./index.d.ts" },
  ])
    await assert.rejects(
      fixture({
        "src/app/page.tsx": 'import "@/scoped"; export default function Page(){return null;}',
        "src/scoped/index.ts": "export const scoped = 1;",
        "src/scoped/package.json": JSON.stringify(config),
      }).run(),
      /nested package resolver\/self-reference scope/u,
    );
  await assert.rejects(
    fixture({
      "src/package.json": JSON.stringify({ browser: { "./shared.ts": "./server/worker.ts" } }),
    }).run(),
    /nested package resolver\/self-reference scope/u,
  );
  // Inactive independent projects retain their bytes without changing the Web resolver scope.
  await fixture({
    "site/package.json": JSON.stringify({ name: "other-project", main: "index.js" }),
  }).run();
  await assert.rejects(
    fixture({ "src/shared.ts": 'import "self";' }).run({
      manifest: { name: "self", dependencies: { self: "1" } },
    }),
    /root package self-reference/u,
  );
});

void test("casts, aliases, destructuring and reflection cannot hide host loaders", async () => {
  for (const source of [
    'const runtime = globalThis; const file = runtime.Bun.file; file(["src","server","worker.ts"].join("/"));',
    'const {file} = (globalThis as any).Bun; file(["src","server","worker.ts"].join("/"));',
    'const runtime = (globalThis as any); runtime["Bun"].file(path);',
    'const loader = Reflect.get(globalThis, "Function"); loader(source)();',
    "const loader = Reflect.get((globalThis as any), key); loader(source)();",
    'const constructor = (globalThis as any)["Function"]; new constructor(source);',
    "const constructor = Function; new constructor(source);",
    'const runtime = global; runtime["process"][key](name);',
    'const runtime = process; const {binding} = runtime; binding("fs");',
    "const runtime = module; runtime[key](path);",
    "const runtime = Bun; runtime.file(path);",
    "const loader = (()=>{}).constructor; loader(source)();",
    'const loader = (()=>{})["constructor"]; loader(source)();',
    "const loader = (()=>{})[key]; loader(source)();",
    'const loader = Reflect.get(()=>{}, "constructor"); loader(source)();',
    'const loader = Object.getOwnPropertyDescriptor(()=>{}, "constructor"); loader?.value(source)();',
    "Reflect.construct(constructor, [source]);",
    "const loader = (()=>{}).constructor.name.constructor; loader(source)();",
  ])
    await assert.rejects(
      fixture({ "src/shared.ts": source }).run(),
      /Web omission policy rejected/u,
      source,
    );
  await fixture({
    "src/shared.ts":
      "export function moduleLabel(module: string){return module;} export const value = globalThis.crypto.randomUUID();",
  }).run();
  await fixture().run({ manifest: { main: "index.js", dependencies: {} } });
  await fixture({
    "src/shared.ts": 'export const value = new Error("label").constructor.name;',
  }).run();
});
