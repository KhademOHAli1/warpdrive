import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { canonical, generateComponentInputs } from "./component_inputs.mjs";
import { WEB_SOURCE_RULES } from "./web_inputs.mjs";
import { generateWebSdkFullInputs } from "./web_sdk_full_inputs.mjs";

const REPOSITORY = fileURLToPath(new URL("../../", import.meta.url));
const CONTEXT = {
  baseImage: "oven/bun@sha256:3f23864d3e8c923975c61971cabe67ee3d5a728f1e25a559256b95af719a3478",
  platform: "linux/amd64",
};
const BACKEND = ["worker", "realtime", "migrator"];
const PAGE = "src/app/page.tsx";
const CARD = "src/components/Card.tsx";
const SWITCH = "src/components/ui/Switch.tsx";
const SWITCH_IMPORT = "@ui-sdk/react/switch";
const SWITCH_CLIENT = `"use client"; import { Switch as SdkSwitch, SwitchThumb } from "${SWITCH_IMPORT}"; export function Card() { return <SdkSwitch><SwitchThumb /></SdkSwitch>; }`;
const CLIENT = '"use client"; import { Menu } from "@ui-sdk/react/menu"; export const Card = Menu;';

function fixture(t) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "warpdrive-web-sdk-inputs-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  function git(...args) {
    return execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
      cwd: root,
      encoding: "utf8",
      env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  }
  function put(path, value) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), value);
  }
  const files = {
    "package.json": JSON.stringify({ dependencies: { react: "^19.3.1", "react-dom": "^19.3.1" } }),
    "bunfig.toml": "[install]\nlinker='hoisted'\n",
    ".dockerignore": ".git\nnode_modules\n.env*\n",
    LICENSE: "fixture license",
    "tsconfig.json": JSON.stringify({
      compilerOptions: { paths: { "@/*": ["./src/*"] }, moduleResolution: "bundler" },
    }),
    "deploy/images/Dockerfile": `FROM ${CONTEXT.baseImage} AS base\n`,
    "patches/example.patch": "patch",
    "third-party/NOTICE.txt": "notice",
    "public/icon.svg": "<svg/>",
    "drizzle/0000.sql": "CREATE TABLE fixture (id int);",
    "drizzle/meta/_journal.json": "{}",
    "next.config.ts": "export default {};",
    "src/app/globals.css": `@import "tailwindcss";\n${WEB_SOURCE_RULES.join("\n")}`,
    "src/shared/backend.ts": "export const backend = 1;",
    "src/features/workflows/v2/codeWorker.ts": "export const code = 1;",
    "src/entrypoints/worker.ts": 'export { backend } from "@/shared/backend";',
    "src/entrypoints/ws.ts": "export const realtime = 1;",
    "src/entrypoints/migrate.ts": "export const migrate = 1;",
    "src/entrypoints/sweepSpam.ts": "export const spam = 1;",
    "scripts/auth-operator.ts": "export const operator = 1;",
    [PAGE]: 'import {Card} from "@/components/Card"; export default Card;',
    [CARD]: "export const Card = () => null;",
  };
  git("init", "--quiet");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "core.autocrlf", "false");
  for (const [path, source] of Object.entries(files)) put(path, source);
  for (const path of [
    "deploy/images/Web.Dockerfile",
    "tools/web-ui/package.json",
    "tools/web-ui/bun.lock",
    "scripts/deployment/web-sdk-import-policy.json",
    "scripts/deployment/web-sdk-controls-import-policy.json",
    "scripts/build-workers.mjs",
    "scripts/deployment/component_inputs.mjs",
    "scripts/deployment/web_inputs.mjs",
  ]) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    copyFileSync(join(REPOSITORY, path), join(root, path));
  }
  // Keep the fixture independent of the large app lock and include only the
  // exact shared singleton resolutions used by the approved Web sidecar.
  const sidecar = ts.parseConfigFileTextToJson(
    "bun.lock",
    readFileSync(join(root, "tools/web-ui/bun.lock"), "utf8"),
  );
  const singletonPackages = ["react", "react-dom", "scheduler"].map((name) => [
    name,
    sidecar.config.packages[name],
  ]);
  put("bun.lock", JSON.stringify({ packages: Object.fromEntries(singletonPackages) }));
  function commit() {
    git("add", "--all");
    git("commit", "--quiet", "--no-gpg-sign", "-m", "fixture source");
    return git("rev-parse", "HEAD");
  }
  return {
    root,
    git,
    put,
    commit,
    sdk: (revision) => generateWebSdkFullInputs({ root, revision, ...CONTEXT }),
    legacy: (components) => generateComponentInputs({ root, components, ...CONTEXT }),
  };
}

void test("reachable SDK imports need a distinct Web receipt while legacy backend bytes remain equal", async (t) => {
  const f = fixture(t);
  const before = f.commit();
  const original = await f.legacy();
  const oldSdk = await f.sdk(before);
  f.put(CARD, CLIENT);
  const after = f.commit();
  await assert.rejects(f.legacy(), /undeclared runtime package @ui-sdk\/react/u);
  const receipt = await f.sdk(after);
  assert.deepEqual(receipt.backendInputs, await f.legacy(BACKEND));
  for (const name of BACKEND)
    assert.deepEqual(receipt.backendInputs.components[name], original.components[name]);
  assert.equal(receipt.sourceRevision, after);
  assert.deepEqual(receipt.web.sdkImports, { [CARD]: ["@ui-sdk/react/menu"] });
  assert.equal(receipt.deploymentAuthorized, false);
  const { inputSha256, ...facts } = receipt.web;
  assert.equal(inputSha256, createHash("sha256").update(canonical(facts)).digest("hex"));
  assert.notEqual(inputSha256, oldSdk.web.inputSha256);
  assert.notEqual(receipt.web.gitInventorySha256, oldSdk.web.gitInventorySha256);
  f.put("src/shared/backend.ts", "export const backend = 2;");
  const mixed = await f.sdk(f.commit());
  assert.notEqual(
    mixed.backendInputs.components.worker.componentInputSha256,
    original.components.worker.componentInputSha256,
  );
  for (const name of ["realtime", "migrator"])
    assert.deepEqual(mixed.backendInputs.components[name], original.components[name]);
});

void test("an SDK overlay never admits the package to a backend or Web helper executable", async (t) => {
  const backend = fixture(t);
  backend.put("src/entrypoints/worker.ts", 'export {Menu} from "@ui-sdk/react/menu";');
  await assert.rejects(
    backend.sdk(backend.commit()),
    /not a declared production dependency: @ui-sdk\/react/u,
  );
  const helper = fixture(t);
  helper.put("scripts/auth-operator.ts", 'export {Card as operator} from "@/components/Card";');
  helper.put(CARD, CLIENT);
  await assert.rejects(
    helper.sdk(helper.commit()),
    /not a declared production dependency: @ui-sdk\/react/u,
  );
  const typeOnly = fixture(t);
  typeOnly.put(CARD, CLIENT.replace("import {", "import type {").replace("= Menu", "= null"));
  typeOnly.put(
    "src/entrypoints/worker.ts",
    `import { Card } from "@/components/Card"; export const runtime = Card;`,
  );
  await assert.rejects(
    typeOnly.sdk(typeOnly.commit()),
    /Web SDK entered an executable non-browser graph/u,
  );
});

void test("unsupported SDK subpaths, reexports, dynamic imports and server imports stay closed", async (t) => {
  const f = fixture(t);
  for (const invalid of [
    CLIENT.replace("/menu", "/undocumented"),
    CLIENT.replace('"use client"; ', ""),
    '"use client"; export {Menu as Card} from "@ui-sdk/react/menu";',
    '"use client"; export const Card = import("@ui-sdk/react/menu");',
    '"use client"; import {Menu as Card} from "@ui-sdk/core"; export {Card};',
  ]) {
    f.put(CARD, invalid);
    await assert.rejects(f.sdk(f.commit()), /Unreviewed Web SDK import/u);
  }
});

void test("tampered SDK pins, shared singleton versions and root SDK installations fail source admission", async (t) => {
  const pins = fixture(t);
  pins.put("tools/web-ui/bun.lock", "{}");
  await assert.rejects(
    pins.sdk(pins.commit()),
    /Unreviewed isolated Web SDK input tools\/web-ui\/bun.lock/u,
  );
  const root = fixture(t);
  root.put("package.json", '{"devDependencies":{"@ui-sdk/react":"0.1.0-beta.1"}}');
  await assert.rejects(
    root.sdk(root.commit()),
    /Web SDK package entered the root manifest or lock/u,
  );
  const singleton = fixture(t);
  singleton.put("bun.lock", '{"packages":{"react":["react@19.2.0"]}}');
  await assert.rejects(singleton.sdk(singleton.commit()), /shared runtime lock differs for react/u);
});

void test("untracked helper resolution and modified backend bytes hidden from Git are rejected", async (t) => {
  const untracked = fixture(t);
  untracked.put("scripts/auth-operator.ts", 'export {ghost as operator} from "./ghost";');
  const before = untracked.commit();
  untracked.put("scripts/ghost.ts", "export const ghost = 1;");
  await assert.rejects(untracked.sdk(before), /unresolved local|unresolved relative|untracked/iu);
  const hidden = fixture(t);
  const revision = hidden.commit();
  const path = "src/shared/backend.ts";
  hidden.git("update-index", "--assume-unchanged", path);
  hidden.put(path, "export const backend = 2;");
  await assert.rejects(hidden.sdk(revision), /differs from the selected Git blob/u);
});

void test("canonical Switch produces versioned named binding evidence alongside the historical pilot", async (t) => {
  const f = fixture(t);
  f.put(
    CARD,
    CLIENT.replace("export const Card = Menu;", "export function Card() { return <Menu />; }"),
  );
  f.put(SWITCH, "export const Card = () => null;");
  f.put(
    PAGE,
    'import {Card} from "@/components/Card"; import {Card as SwitchCard} from "@/components/ui/Switch"; export default [Card, SwitchCard];',
  );
  const baseline = await f.sdk(f.commit());
  assert.equal(baseline.schemaVersion, 1);
  assert.equal(Object.hasOwn(baseline.web, "sdkBindings"), false);
  f.put(SWITCH, SWITCH_CLIENT);
  const successor = await f.sdk(f.commit());
  assert.equal(successor.schemaVersion, 2);
  assert.deepEqual(successor.backendInputs, baseline.backendInputs);
  assert.deepEqual(successor.web.sdkImports, {
    [CARD]: ["@ui-sdk/react/menu"],
    [SWITCH]: [SWITCH_IMPORT],
  });
  assert.deepEqual(successor.web.sdkBindings[SWITCH], [
    { specifier: SWITCH_IMPORT, exported: "Switch", local: "SdkSwitch" },
    { specifier: SWITCH_IMPORT, exported: "SwitchThumb", local: "SwitchThumb" },
  ]);
  assert.equal(
    successor.web.importPolicySha256,
    createHash("sha256")
      .update(readFileSync(join(REPOSITORY, "scripts/deployment/web-sdk-import-policy.json")))
      .digest("hex"),
  );
  assert.equal(successor.deploymentAuthorized, false);
  f.put(CARD, CLIENT.replace("{ Menu }", "{ Undocumented as Menu }"));
  await assert.rejects(f.sdk(f.commit()), /Unreviewed Web SDK import/u);
});

void test("the Switch SDK cannot enter other UI files or a helper/backend closure", async (t) => {
  const f = fixture(t);
  f.put(CARD, SWITCH_CLIENT);
  await assert.rejects(f.sdk(f.commit()), /Unreviewed Web SDK import/u);
  f.put(CARD, 'export {Card} from "@/components/ui/Switch";');
  f.put(SWITCH, SWITCH_CLIENT);
  const baseline = f.commit();
  for (const entry of ["src/entrypoints/worker.ts", "scripts/auth-operator.ts"]) {
    f.put(entry, 'export {Card} from "@/components/ui/Switch";');
    await assert.rejects(
      f.sdk(f.commit()),
      /not a declared production dependency: @ui-sdk\/react/u,
    );
    f.git("reset", "--hard", baseline);
  }
});

void test("Checkbox and Quick Add Combobox independently select v3 without requiring Switch", async (t) => {
  const f = fixture(t);
  const checkbox = "src/components/ui/Checkbox.tsx";
  const combobox = "src/components/ui/SdkCombobox.tsx";
  const checkboxImport = "@ui-sdk/react/checkbox";
  const comboImport = "@ui-sdk/react/combobox";
  f.put(
    checkbox,
    `"use client"; import { Checkbox } from "${checkboxImport}"; export function Card() { return <Checkbox />; }`,
  );
  f.put(
    combobox,
    `"use client"; import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput,
    ComboboxItem, ComboboxList, ComboboxTrigger } from "${comboImport}";
    export function Card() { return <Combobox><ComboboxTrigger/><ComboboxContent><ComboboxInput/><ComboboxList><ComboboxItem/><ComboboxEmpty/></ComboboxList></ComboboxContent></Combobox>; }`,
  );
  const unused = await f.sdk(f.commit());
  assert.equal(unused.schemaVersion, 1);
  for (const [name, path, specifier] of [
    ["Checkbox", checkbox, checkboxImport],
    ["SdkCombobox", combobox, comboImport],
  ]) {
    f.put(CARD, `export { Card } from "@/components/ui/${name}";`);
    const selected = await f.sdk(f.commit());
    assert.equal(selected.schemaVersion, 3);
    assert.deepEqual(selected.web.sdkImports, { [path]: [specifier] });
    assert.deepEqual(selected.backendInputs, unused.backendInputs);
    assert.equal(
      selected.web.importPolicySha256,
      createHash("sha256")
        .update(
          readFileSync(join(REPOSITORY, "scripts/deployment/web-sdk-controls-import-policy.json")),
        )
        .digest("hex"),
    );
  }
  f.put(SWITCH, SWITCH_CLIENT);
  f.put(
    CARD,
    `import { Card as A } from "@/components/ui/Checkbox"; import { Card as B } from "@/components/ui/SdkCombobox";
    import { Card as C } from "@/components/ui/Switch"; export function Card() { return <><A/><B/><C/></>; }`,
  );
  const all = await f.sdk(f.commit());
  assert.equal(all.schemaVersion, 3);
  assert.deepEqual(all.web.sdkImports, {
    [checkbox]: [checkboxImport],
    [combobox]: [comboImport],
    [SWITCH]: [SWITCH_IMPORT],
  });
  const baseline = f.git("rev-parse", "HEAD");
  for (const [entry, leaf] of [
    ["src/entrypoints/worker.ts", "Checkbox"],
    ["scripts/auth-operator.ts", "SdkCombobox"],
  ]) {
    f.put(entry, `export { Card } from "@/components/ui/${leaf}";`);
    await assert.rejects(
      f.sdk(f.commit()),
      /not a declared production dependency: @ui-sdk\/react/u,
    );
    f.git("reset", "--hard", baseline);
  }
});

void test("the reviewed dialog remains a v1 import until a registered control selects v3", async (t) => {
  const f = fixture(t);
  const dialog = "src/components/ui/SdkDialog.tsx";
  const source =
    '"use client"; import { DialogBackdrop } from "@ui-sdk/react/dialog"; export function Card() { return <DialogBackdrop />; }';
  f.put(dialog, source);
  f.put(CARD, 'export { Card } from "@/components/ui/SdkDialog";');
  assert.equal((await f.sdk(f.commit())).schemaVersion, 1);

  f.put(SWITCH, SWITCH_CLIENT);
  f.put(
    CARD,
    'import { Card as A } from "@/components/ui/SdkDialog"; import { Card as B } from "@/components/ui/Switch"; export function Card() { return <><A/><B/></>; }',
  );
  await assert.rejects(
    f.sdk(f.commit()),
    /Unreviewed Web SDK import in src\/components\/ui\/SdkDialog\.tsx/u,
  );

  const checkbox = "src/components/ui/Checkbox.tsx";
  f.put(
    checkbox,
    '"use client"; import { Checkbox } from "@ui-sdk/react/checkbox"; export function Card() { return <Checkbox />; }',
  );
  f.put(
    CARD,
    'import { Card as A } from "@/components/ui/SdkDialog"; import { Card as B } from "@/components/ui/Checkbox"; export function Card() { return <><A/><B/></>; }',
  );
  const v3 = await f.sdk(f.commit());
  assert.equal(v3.schemaVersion, 3);
  assert.deepEqual(v3.web.sdkBindings[dialog], [
    { specifier: "@ui-sdk/react/dialog", exported: "DialogBackdrop", local: "DialogBackdrop" },
  ]);
  f.put(
    CARD,
    source
      .replace("return <DialogBackdrop />", "return <><DialogBackdrop/><B/></>")
      .replace(
        "export function",
        'import {Card as B} from "@/components/ui/Checkbox"; export function',
      ),
  );
  await assert.rejects(
    f.sdk(f.commit()),
    /Unreviewed Web SDK import in src\/components\/Card\.tsx/u,
  );
});
