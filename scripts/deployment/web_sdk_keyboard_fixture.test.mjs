import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { selectBuildEntries } from "../build-workers.mjs";
import { verifyWebFunctionalSource } from "./web_functional_source.mjs";
import { WEB_SOURCE_RULES } from "./web_inputs.mjs";
import {
  fixtureAdapterSource,
  fixtureSource,
  verifySdkKeyboardHelp,
} from "./web_sdk_keyboard_fixture.mjs";

const LEAF = "src/components/shell/KeyboardHelpFixture.tsx";
const ADAPTER = "src/components/shell/KeyboardHelpFixtureAdapter.tsx";

async function createFixture(context) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "wd-sdk-keyboard-")));
  context.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        LC_ALL: "C",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
      },
      timeout: 10000,
    })
      .toString("utf8")
      .trim();
  async function commit(changes) {
    for (const [path, contents] of Object.entries(changes)) {
      const file = join(root, path);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, contents);
    }
    git("add", "--all");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-qm",
      "Fixture",
    );
    return git("rev-parse", "HEAD");
  }
  git("init", "-q");
  const baseline = await commit({
    ...Object.fromEntries(selectBuildEntries("all").map(({ in: path }) => [path, "export {};"])),
    "package.json": '{"name":"fixture","dependencies":{"react":"19.3.1"}}',
    "bun.lock": '{"packages":{"react":["react@19.3.1"]}}',
    "next.config.ts": "export default {};",
    "tsconfig.json":
      '{"compilerOptions":{"paths":{"@/*":["./src/*"]},"moduleResolution":"bundler"}}',
    "src/app/globals.css": `@import "tailwindcss";\n${WEB_SOURCE_RULES.join("\n")}`,
    "src/app/page.tsx":
      'export { KeyboardHelpFixtureAdapter as default } from "@/components/shell/KeyboardHelpFixtureAdapter";',
    "tools/web-ui/package.json": await readFile(
      new URL("../../tools/web-ui/package.json", import.meta.url),
    ),
    "tools/web-ui/bun.lock": await readFile(
      new URL("../../tools/web-ui/bun.lock", import.meta.url),
    ),
    [ADAPTER]: fixtureAdapterSource(),
    [LEAF]: fixtureSource({ sdk: false }),
  });
  return { root, baseline, commit };
}

void test("the generated SDK client leaf passes the exact v1 profile with its immutable adapter", async (context) => {
  const f = await createFixture(context);
  const current = await f.commit({ [LEAF]: fixtureSource({ sdk: true }) });
  const evidence = await verifyWebFunctionalSource({
    root: f.root,
    baselineRevision: f.baseline,
    currentRevision: current,
    profile: { version: 1, modules: [LEAF], styles: [], adapters: [ADAPTER] },
  });
  assert.deepEqual(
    evidence.changed.map(({ path }) => path),
    [LEAF],
  );
  assert.equal(evidence.deploymentAuthorized, false);
  assert.match(fixtureSource({ sdk: false }), /aria-modal="false"/u);
  assert.match(fixtureSource({ sdk: true }), /@ui-sdk\/react\/dialog/u);
  assert.throws(() => fixtureSource({ sdk: "yes" }), /explicitly/u);
});

void test("the browser witness rejects invalid budgets before reading the page", async () => {
  for (const timeout of [0, 15001, Number.NaN, "5000"]) {
    await assert.rejects(verifySdkKeyboardHelp({}, { timeout }), /browser evidence/u);
  }
});
