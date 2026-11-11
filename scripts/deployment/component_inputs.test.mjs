import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  COMPONENTS,
  canonical,
  generateComponentInputs,
  parseInputArguments,
} from "./component_inputs.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CONTEXT = { baseImage: `oven/bun@sha256:${"a".repeat(64)}`, platform: "linux/amd64" };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "warpdrive-component-inputs-"));
  const put = (name, contents) => {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), contents);
  };
  const files = {
    "package.json": JSON.stringify({ dependencies: {} }),
    "bun.lock": '{"packages":{}}',
    "bunfig.toml": "[install]\nlinker='hoisted'\n",
    ".dockerignore": ".git\nnode_modules\n.env*\n",
    LICENSE: "license",
    "tsconfig.json": JSON.stringify({
      compilerOptions: { paths: { "@/*": ["./src/*"] }, target: "ES2022" },
    }),
    "deploy/images/Dockerfile": `FROM ${CONTEXT.baseImage} AS base\n`,
    "patches/example.patch": "patch",
    "third-party/NOTICE.txt": "notice",
    "public/icon.svg": "<svg/>",
    "drizzle/0000.sql": "CREATE TABLE fixture (id int);",
    "drizzle/meta/_journal.json": "{}",
    "next.config.ts": "export default {};",
    "src/shared/backend.ts": "export const backend = 1;",
    "src/shared/code.ts": "export const code = 1;",
    "src/shared/spam.ts": "export const spam = 1;",
    "src/shared/operator.ts": "export const operator = 1;",
    "src/features/workflows/v2/codeWorker.ts": 'import {code} from "@/shared/code"; export {code};',
    "src/entrypoints/worker.ts": 'import {backend} from "@/shared/backend"; export {backend};',
    "src/entrypoints/ws.ts": 'import {backend} from "@/shared/backend"; export {backend};',
    "src/entrypoints/migrate.ts": "export const migrate = 1;",
    "src/entrypoints/sweepSpam.ts": 'import {spam} from "@/shared/spam"; export {spam};',
    "scripts/auth-operator.ts": 'import {operator} from "@/shared/operator"; export {operator};',
    "src/ui/Card.tsx": "export const Card = () => <div className='grid'/>;",
  };
  for (const [name, contents] of Object.entries(files)) put(name, contents);
  for (const path of ["scripts/build-workers.mjs", "scripts/deployment/component_inputs.mjs"]) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    copyFileSync(join(repository, path), join(root, path));
  }
  return {
    root,
    put,
    collect: (options = {}) => generateComponentInputs({ root, ...CONTEXT, ...options }),
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}
const hashes = (value) =>
  Object.fromEntries(COMPONENTS.map((name) => [name, value.components[name].componentInputSha256]));
const changed = (before, after) =>
  COMPONENTS.filter((name) => hashes(before)[name] !== hashes(after)[name]);
function allFiles(root) {
  return readdirSync(root, { recursive: true }).sort();
}

void test("canonical JSON is recursive UTF-8 key-sorted and independently recomputable in Python", () => {
  const value = { z: [{ é: 2, a: 1 }], a: "😀" };
  const python = spawnSync(
    "python3",
    [
      "-c",
      "import json,sys; print(json.dumps(json.loads(sys.stdin.read()),sort_keys=True,separators=(',',':'),ensure_ascii=False),end='')",
    ],
    { input: JSON.stringify(value), encoding: "utf8", timeout: 5000 },
  );
  assert.equal(python.status, 0, python.stderr);
  assert.equal(canonical(value), python.stdout);
  assert.throws(() => canonical({ a: Number.NaN }));
  assert.throws(() => canonical({ a: undefined }));
});

void test("fresh discovery is deterministic, includes all helpers/assets, and writes no output/source", async () => {
  const f = fixture();
  try {
    const before = allFiles(f.root);
    const result = await f.collect();
    assert.deepEqual(result, await f.collect());
    assert.deepEqual(allFiles(f.root), before);
    assert.equal(existsSync(join(f.root, "dist")), false);
    assert.equal(existsSync(join(f.root, ".next")), false);
    for (const name of COMPONENTS) {
      const component = result.components[name];
      assert.equal(component.inputPolicySha256, result.inputPolicySha256);
      const digest = createHash("sha256")
        .update(
          canonical({ inputPolicySha256: result.inputPolicySha256, inputs: component.inputs }),
        )
        .digest("hex");
      assert.equal(component.componentInputSha256, digest);
      assert.deepEqual(
        component.inputs.map((input) => input.path),
        [...new Set(component.inputs.map((input) => input.path))].sort(),
      );
      assert.ok(
        component.inputs.every(
          (input) => /^[a-f0-9]{64}$/.test(input.sha256) && Number.isSafeInteger(input.bytes),
        ),
      );
    }
    assert.equal(
      result.inputPolicySha256,
      createHash("sha256").update(canonical(result.policy)).digest("hex"),
    );
    for (const name of ["worker", "web"]) {
      for (const path of ["src/shared/code.ts", "src/shared/spam.ts"])
        assert.ok(result.components[name].graphInputs.includes(path));
    }
    for (const name of ["web", "migrator"])
      assert.ok(result.components[name].graphInputs.includes("src/shared/operator.ts"));
    assert.ok(
      result.components.migrator.inputs.some(
        (input) => input.path === "drizzle/meta/_journal.json",
      ),
    );
    assert.match(result.components.web.graphKind, /helpers-plus-conservative/);
    assert.match(result.components.web.limitations.join(" "), /not.*Next|not a discovered Next/);
  } finally {
    f.close();
  }
});

void test("UI changes leave backend hashes intact while imported backend changes invalidate fresh transitive inputs", async () => {
  const f = fixture();
  try {
    const original = await f.collect();
    f.put("src/ui/Card.tsx", "export const Card = () => <section className='flex'/>;");
    const ui = await f.collect();
    assert.deepEqual(changed(original, ui), ["web"]);
    f.put("src/shared/backend.ts", "export const backend = 2;");
    assert.deepEqual(changed(ui, await f.collect()), ["web", "worker", "realtime"]);
  } finally {
    f.close();
  }
});

void test("new imports are resolved on every collection and their subsequent changes invalidate affected components", async () => {
  const f = fixture();
  try {
    const first = await f.collect();
    f.put("src/newlyImported.ts", "export const added = 1;");
    f.put("src/entrypoints/worker.ts", 'import {added} from "@/newlyImported"; export {added};');
    const added = await f.collect();
    assert.deepEqual(changed(first, added), ["web", "worker"]);
    assert.ok(added.components.worker.graphInputs.includes("src/newlyImported.ts"));
    f.put("src/newlyImported.ts", "export const added = 2;");
    assert.deepEqual(changed(added, await f.collect()), ["web", "worker"]);
  } finally {
    f.close();
  }
});

void test("runtime child/operator/spam inputs and full SQL trees cannot be omitted from component reuse", async () => {
  const f = fixture();
  try {
    let previous = await f.collect();
    for (const [path, expected] of [
      ["src/shared/code.ts", ["web", "worker"]],
      ["src/shared/spam.ts", ["web", "worker"]],
      ["src/shared/operator.ts", ["web", "migrator"]],
      ["drizzle/0001.sql", ["web", "migrator"]],
    ]) {
      f.put(
        path,
        path.endsWith(".sql")
          ? "ALTER TABLE fixture ADD COLUMN extra int;"
          : "export const code=2,spam=2,operator=2;",
      );
      const next = await f.collect();
      assert.deepEqual(changed(previous, next), expected, path);
      previous = next;
    }
  } finally {
    f.close();
  }
});

void test("shared locked dependencies, patches, recipe, policy, licenses, configuration and semantic context invalidate every image", async () => {
  const f = fixture();
  try {
    let previous = await f.collect();
    for (const path of [
      "bun.lock",
      "patches/example.patch",
      "deploy/images/Dockerfile",
      "scripts/deployment/component_inputs.mjs",
      "third-party/NOTICE.txt",
      "LICENSE",
    ]) {
      f.put(
        path,
        `${readFileSync(join(f.root, path), "utf8")}\n${path.endsWith("Dockerfile") ? "#" : "//"} reviewed change`,
      );
      const next = await f.collect();
      assert.deepEqual(changed(previous, next), COMPONENTS, path);
      previous = next;
    }
    f.put("package.json", JSON.stringify({ dependencies: {}, version: "2.0.0" }));
    const packageChanged = await f.collect();
    assert.deepEqual(changed(previous, packageChanged), COMPONENTS);
    for (const context of [
      { buildArgs: { APP_VERSION: "version-2" } },
      { buildArgs: { NEXT_PUBLIC_WS_URL: "wss://example.invalid/_ws" } },
    ])
      assert.deepEqual(changed(packageChanged, await f.collect(context)), COMPONENTS);
  } finally {
    f.close();
  }
});

void test("source revisions are excluded provenance, never relabeling or component input options", async () => {
  const f = fixture();
  try {
    for (const options of [
      { sourceRevision: "a".repeat(40) },
      { buildArgs: { APP_COMMIT: "a".repeat(40) } },
      { baseImage: "oven/bun:1.4.4" },
      { platform: "linux/arm64" },
    ])
      await assert.rejects(f.collect(options));
    assert.throws(() => parseInputArguments(["--source-revision", "a".repeat(40)]));
    assert.throws(() =>
      parseInputArguments(["--build-arg", "APP_VERSION=1", "--build-arg", "APP_VERSION=2"]),
    );
    assert.throws(() => parseInputArguments(["--component", "worker", "--component", "web"]));
    await assert.rejects(
      f.collect({ baseImage: `oven/bun@sha256:${"b".repeat(64)}` }),
      /actual fixed Dockerfile/,
    );
    const first = await f.collect();
    assert.ok(!canonical(first).includes("sourceRevision"));
    f.put(".git/HEAD", "ref: refs/heads/different-source-revision");
    assert.deepEqual(first, await f.collect());
  } finally {
    f.close();
  }
});

void test("missing imports, unresolved aliases, undeclared packages and graph warnings fail closed", async () => {
  const f = fixture();
  try {
    for (const source of [
      'import "./missing";',
      'import "@/missing";',
      'import "undeclared-package";',
      "switch(1){case 1:break;case 1:break;}",
    ]) {
      f.put("src/entrypoints/worker.ts", source);
      await assert.rejects(f.collect({ components: ["worker"] }), undefined, source);
    }
  } finally {
    f.close();
  }
});

void test("symlinked app imports, assets, ancestors, and nonregular paths are rejected", async () => {
  const f = fixture();
  try {
    symlinkSync("backend.ts", join(f.root, "src/shared/linked.ts"));
    f.put(
      "src/entrypoints/worker.ts",
      'import {backend} from "@/shared/linked"; export {backend};',
    );
    await assert.rejects(f.collect({ components: ["worker"] }), /Symlink/);
    rmSync(join(f.root, "src/shared/linked.ts"));
    f.put("src/entrypoints/worker.ts", "export const valid=1;");
    symlinkSync(join(f.root, "LICENSE"), join(f.root, "third-party/linked"));
    await assert.rejects(f.collect({ components: ["worker"] }), /Symlink/);
    rmSync(join(f.root, "third-party/linked"));
    rmSync(join(f.root, "LICENSE"));
    mkdirSync(join(f.root, "LICENSE"));
    await assert.rejects(f.collect({ components: ["worker"] }), /Non-regular/);
  } finally {
    f.close();
  }
});

void test("escaping imports, config inheritance and local dependency/lifecycle assets require explicit review", async () => {
  const f = fixture();
  try {
    f.put("outside.ts", "export const outside=1;");
    f.put("src/entrypoints/worker.ts", 'import "../../../outside.ts";');
    await assert.rejects(f.collect({ components: ["worker"] }));
    f.put("src/entrypoints/worker.ts", "export const valid=1;");
    f.put("tsconfig.json", '{"extends":"./inherited.json"}');
    await assert.rejects(f.collect({ components: ["worker"] }), /tsconfig/);
    f.put("tsconfig.json", "{}");
    f.put("package.json", '{"dependencies":{"local":"file:./outside"}}');
    await assert.rejects(f.collect({ components: ["worker"] }), /Local production/);
    f.put("package.json", '{"scripts":{"postinstall":"node outside.js"}}');
    await assert.rejects(f.collect({ components: ["worker"] }), /lifecycle/);
  } finally {
    f.close();
  }
});

void test("immutable base context must match every fixed FROM and coordinated base changes invalidate all components", async () => {
  const f = fixture();
  try {
    const first = await f.collect();
    const baseImage = `oven/bun@sha256:${"b".repeat(64)}`;
    f.put("deploy/images/Dockerfile", `FROM ${baseImage} AS base\nFROM base AS runtime-base\n`);
    await assert.rejects(f.collect(), /actual fixed Dockerfile/);
    assert.deepEqual(changed(first, await f.collect({ baseImage })), COMPONENTS);
    for (const suffix of [
      "FROM ubuntu:latest",
      "FROM $BASE AS extra",
      "FROM scratch AS extra",
      "FROM base AS base",
    ]) {
      f.put("deploy/images/Dockerfile", `FROM ${CONTEXT.baseImage} AS base\n${suffix}\n`);
      await assert.rejects(f.collect());
    }
  } finally {
    f.close();
  }
});

void test("locked transitive production runtime packages are admitted while dev-only packages are not", async () => {
  const f = fixture();
  try {
    f.put(
      "package.json",
      JSON.stringify({ dependencies: { parent: "1.0.0" }, devDependencies: { devonly: "1.0.0" } }),
    );
    f.put(
      "bun.lock",
      JSON.stringify({
        packages: {
          parent: ["parent@1.0.0", "", { dependencies: { child: "1.0.0" } }, "sha512-fixture"],
          child: ["child@1.0.0", "", {}, "sha512-fixture"],
          devonly: ["devonly@1.0.0", "", {}, "sha512-fixture"],
        },
      }),
    );
    f.put("src/entrypoints/worker.ts", 'import "child/runtime-data"; import "node:fs";');
    await f.collect({ components: ["worker"] });
    f.put("src/entrypoints/worker.ts", 'import "devonly";');
    await assert.rejects(f.collect({ components: ["worker"] }), /declared production dependency/);
  } finally {
    f.close();
  }
});

void test("symlink ancestors and inputs outside the checkout cannot enter a reusable graph", async () => {
  const f = fixture();
  const outside = `${f.root}-outside.ts`;
  try {
    symlinkSync(join(f.root, "src/shared"), join(f.root, "src/alias"), "dir");
    f.put("src/entrypoints/worker.ts", 'import "@/alias/backend";');
    await assert.rejects(f.collect({ components: ["worker"] }), /Symlink/);
    writeFileSync(outside, "export const outside=1;");
    f.put("src/entrypoints/worker.ts", `import ${JSON.stringify(outside)};`);
    await assert.rejects(f.collect({ components: ["worker"] }), /Escaping|Unsafe/);
  } finally {
    rmSync(outside, { force: true });
    f.close();
  }
});

void test("oversized files fail before hashing unbounded asset bytes", async () => {
  const f = fixture();
  try {
    truncateSync(join(f.root, "third-party/NOTICE.txt"), 33 * 1024 * 1024);
    await assert.rejects(f.collect({ components: ["realtime"] }), /Unbounded/);
  } finally {
    f.close();
  }
});
