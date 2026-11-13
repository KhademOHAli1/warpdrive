import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { projectWebUiScope } from "./install-web-ui.mjs";

const SHARED = ["react", "react-dom", "scheduler"];
const REACT_ENTRY = "react/index.js";
const SDK_CORE = "@ui-sdk/core/dist/index.js";
const SDK_REACT = "@ui-sdk/react/dist/primitive.js";

function put(parent, name, content) {
  const path = join(parent, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return path;
}

function sidecar(root, name) {
  const source = join(root, name, "node_modules");
  for (const leaf of [SDK_CORE, SDK_REACT, ...SHARED.map((name) => `${name}/index.js`)]) {
    put(source, leaf, leaf);
  }
  return source;
}

function fixture(context) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "wd-install-web-ui-")));
  context.after(() => rmSync(root, { recursive: true }));
  const source = sidecar(root, "prepared");
  const target = join(root, "app/node_modules");
  for (const name of SHARED) put(target, `${name}/index.js`, `${name}/index.js`);
  return { root, source, target, project: () => projectWebUiScope(source, target) };
}

void test("complete scope moves atomically and idempotent replay preserves exact directory", (context) => {
  const f = fixture(context);
  const runtime = lstatSync(join(f.target, "react"));
  const scope = lstatSync(join(f.source, "@ui-sdk"));
  assert.equal(f.project(), "installed");
  assert.equal(lstatSync(join(f.target, "@ui-sdk")).ino, scope.ino);
  assert.equal(lstatSync(join(f.target, "react")).ino, runtime.ino);
  assert.deepEqual(readdirSync(f.target).sort(), ["@ui-sdk", ...SHARED]);
  assert.equal(readFileSync(join(f.target, SDK_REACT), "utf8"), SDK_REACT);
  assert.deepEqual(readdirSync(f.source).sort(), SHARED);
  const identical = sidecar(f.root, "second");
  assert.equal(projectWebUiScope(identical, f.target), "unchanged");
  assert.equal(lstatSync(join(f.target, "@ui-sdk")).ino, scope.ino);
});

void test("foreign, partial, changed and nested SDK scopes are held without overwriting", (context) => {
  const f = fixture(context);
  const destination = join(f.target, "@ui-sdk");
  mkdirSync(destination);
  const inode = lstatSync(destination).ino;
  assert.throws(f.project, /foreign or missing/u);
  assert.equal(lstatSync(destination).ino, inode);
  assert.deepEqual(readdirSync(destination), []);
  put(f.target, SDK_CORE, SDK_CORE);
  put(f.target, SDK_REACT, "changed package bytes");
  assert.throws(f.project, /differ from the reviewed install/u);
  assert.equal(readFileSync(join(f.target, SDK_REACT), "utf8"), "changed package bytes");
  put(f.target, SDK_REACT, SDK_REACT);
  put(f.target, "@ui-sdk/react/node_modules/react/index.js", "second runtime");
  assert.throws(f.project, /Unsafe or excessive/u);
  assert.ok(lstatSync(join(f.source, SDK_CORE)).isFile());
});

void test("existing directory and file symlinks cannot redirect the projection", (context) => {
  const f = fixture(context);
  const outside = join(f.root, "outside");
  mkdirSync(outside);
  const alias = join(f.root, "aliased-modules");
  symlinkSync(f.target, alias);
  assert.throws(() => projectWebUiScope(f.source, alias), /canonical directory/u);
  symlinkSync(outside, join(f.target, "@ui-sdk"));
  assert.throws(f.project, /canonical directory/u);
  assert.deepEqual(readdirSync(outside), []);
  rmSync(join(f.target, "@ui-sdk"));
  const sourceEntry = join(f.source, SDK_CORE);
  rmSync(sourceEntry);
  symlinkSync(join(f.target, REACT_ENTRY), sourceEntry);
  assert.throws(f.project, /ELOOP/u);
  assert.deepEqual(readdirSync(f.target).sort(), SHARED);
});

void test("changed React bytes and hard-linked SDK files fail before scope publication", (context) => {
  const f = fixture(context);
  put(f.target, REACT_ENTRY, "different shared runtime");
  assert.throws(f.project, /exact physical React/u);
  assert.deepEqual(readdirSync(f.target).sort(), SHARED);
  put(f.target, REACT_ENTRY, REACT_ENTRY);
  linkSync(join(f.source, SDK_REACT), join(f.root, "outside-link"));
  assert.throws(f.project, /Unsafe or oversized/u);
  assert.deepEqual(readdirSync(f.target).sort(), SHARED);
});

void test("concurrent installers converge on one complete scope", (context) => {
  const f = fixture(context);
  const sources = [f.source, sidecar(f.root, "second")];
  const child = `import { projectWebUiScope } from ${JSON.stringify(new URL("./install-web-ui.mjs", import.meta.url).href)};
const [source, target] = process.argv.slice(1);
process.stdout.write(projectWebUiScope(source, target));`;
  const results = sources.map((source) =>
    Bun.spawn([process.execPath, "--no-env-file", "-e", child, source, f.target], {
      stdout: "pipe",
      stderr: "pipe",
    }),
  );
  return Promise.all(
    results.map(async (child) => {
      const [exit, output, diagnostics] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      assert.equal(exit, 0, diagnostics);
      return output;
    }),
  ).then((statuses) => {
    assert.deepEqual(statuses.sort(), ["installed", "unchanged"]);
    assert.equal(readFileSync(join(f.target, SDK_CORE), "utf8"), SDK_CORE);
    assert.equal(readFileSync(join(f.target, SDK_REACT), "utf8"), SDK_REACT);
  });
});

void test("CLI refuses alternate public or mismatched app roots before running Bun install", (context) => {
  const f = fixture(context);
  const app = dirname(f.target);
  const script = fileURLToPath(new URL("./install-web-ui.mjs", import.meta.url));
  function invoke() {
    const result = spawnSync(process.execPath, ["--no-env-file", script, "--target", app], {
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(result.status, 1);
    return result.stderr;
  }
  chmodSync(app, 0o755);
  assert.match(invoke(), /private \(mode 0700\)/u);
  chmodSync(app, 0o700);
  put(app, "package.json", "{}");
  assert.match(invoke(), /lock and manifest must match/u);
  assert.deepEqual(readdirSync(f.target).sort(), SHARED);
});
