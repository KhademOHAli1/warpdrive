import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { selectBuildEntries } from "../build-workers.mjs";
import { WEB_SOURCE_RULES } from "./web_inputs.mjs";
import { verifyWebProtectedProjection } from "./web_protected_projection.mjs";

const PAGE = "src/app/(app)/page.tsx";
const LEAF = "src/components/shell/Renderer.tsx";
const MOUNT = "src/components/shell/Mount.tsx";
const API = "src/app/api/example/route.ts";
const ACTION = "src/app/(app)/actions.ts";
const AUTH = "src/features/auth/probe.ts";
const ENV = "src/config/env.ts";
const HELPER = "src/lib/helper.ts";
const SERVER = "src/lib/ssr.ts";
const STYLE = "src/components/shell/Mount.module.css";
const NESTED_STYLE = "src/components/shell/SSR.module.css";
const REFERENCED_STYLE = "src/components/shell/Reference.module.css";
const BEFORE = '"use client"; export function Renderer() { return <span>Before</span>; }';
const AFTER = BEFORE.replace("Before", "After");
const ADAPTER =
  'import { Renderer as View } from "./Renderer"; export function Mount() { return <View />; }';
const CUTS = [{ from: MOUNT, to: LEAF, bindings: [{ name: "Renderer", local: "View" }] }];

async function fixture(context, overrides = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "wd-protected-projection-")));
  context.after(() => rm(root, { recursive: true, force: true }));
  function git(...args) {
    return execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        LC_ALL: "C",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
      },
    })
      .toString("utf8")
      .trim();
  }
  async function commit(changes) {
    for (const [path, content] of Object.entries(changes)) {
      const file = join(root, path);
      await mkdir(dirname(file), { recursive: true });
      if (content === null) await rm(file);
      else await writeFile(file, content);
    }
    git("add", "--all");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--allow-empty",
      "-qm",
      "Fixture",
    );
    return git("rev-parse", "HEAD");
  }
  git("init", "-q");
  const baselineRevision = await commit({
    ...Object.fromEntries(selectBuildEntries("all").map(({ in: path }) => [path, "export {}; "])),
    "package.json": '{"name":"fixture","dependencies":{"react":"19.3.1"}}',
    "bun.lock": '{"packages":{"react":["react@19.3.1"]}}',
    "next.config.ts": "export default {};",
    "tsconfig.json":
      '{"compilerOptions":{"paths":{"@/*":["./src/*"]},"moduleResolution":"bundler"}}',
    "src/app/globals.css": `@import "tailwindcss";\n${WEB_SOURCE_RULES.join("\n")}`,
    [PAGE]:
      'import { Mount } from "@/components/shell/Mount"; export default function Page() { return <Mount />; }',
    [MOUNT]: ADAPTER,
    [LEAF]: BEFORE,
    [API]:
      'import { value } from "@/lib/helper"; export function GET() { return Response.json(value); }',
    [ACTION]: 'export async function save() { "use server"; return 1; }',
    [AUTH]: "export const auth = true;",
    [ENV]: "export const env = true;",
    [HELPER]: "export const value = 1;",
    [SERVER]: 'import "next/headers"; export const server = true;',
    ...overrides,
  });
  return async (changes, rendererCuts = CUTS) => {
    git("checkout", "--quiet", "--detach", baselineRevision);
    const currentRevision = await commit(changes);
    // The proof uses raw trees even when the corresponding working source is dirty.
    if (changes[LEAF] !== null) await writeFile(join(root, LEAF), "this is not Git source");
    try {
      return await verifyWebProtectedProjection({
        root,
        baselineRevision,
        currentRevision,
        rendererCuts,
      });
    } finally {
      if (changes[LEAF] !== null) git("restore", "--", LEAF);
    }
  };
}

void test("exact preexisting render-only edge permits a client body or client-only module change", async (context) => {
  const verify = await fixture(context);
  const first = await verify({ [LEAF]: AFTER });
  const second = await verify({
    [LEAF]:
      '"use client"; import { copy } from "./copy"; export function Renderer() { return <span>{copy}</span>; }',
    "src/components/shell/copy.ts": 'export const copy = "After";',
  });
  assert.equal(first.kind, "warpdrive-web-protected-source-projection");
  assert.equal(first.deploymentAuthorized, false);
  assert.notEqual(first.currentRevision, second.currentRevision);
  assert.equal(first.protectedProjectionSha256, second.protectedProjectionSha256);
  const withRemoval = await fixture(context, {
    [LEAF]:
      '"use client"; import { copy } from "./copy"; export function Renderer() { return <span>{copy}</span>; }',
    "src/components/shell/copy.ts": 'export const copy = "Before";',
  });
  const third = await withRemoval({ [LEAF]: AFTER, "src/components/shell/copy.ts": null });
  assert.equal(first.protectedProjectionSha256, third.protectedProjectionSha256);
  assert.equal(first.rendererCutsSha256, second.rendererCutsSha256);
  assert.match(first.protectedProjectionSha256, /^[a-f0-9]{64}$/u);
  assert.ok(first.protectedFiles > first.protectedRoots);
  await assert.rejects(verify({ [LEAF]: AFTER }, []), /Protected structural source/u);
});

void test("immutable SSR mount, API, Server Action, auth, env, and backend helper bytes are protected", async (context) => {
  const verify = await fixture(context);
  await assert.rejects(
    verify({ [LEAF]: AFTER, [MOUNT]: `${ADAPTER}\n// new` }),
    /mount remain immutable/u,
  );
  for (const path of [
    API,
    ACTION,
    AUTH,
    ENV,
    HELPER,
    SERVER,
    PAGE,
    ...selectBuildEntries("all")
      .map(({ in: entry }) => entry)
      .filter((entry) => entry !== "next.config.ts"),
  ]) {
    const changed =
      path === ACTION
        ? 'export async function save() { "use server"; return 2; }'
        : "export const changed = 1;";
    await assert.rejects(
      verify({ [LEAF]: AFTER, [path]: changed }),
      /(?:Protected structural source|bypassed by another)/u,
    );
  }
});

void test("edge shadowing changes the protected projection even with identical protected import bytes", async (context) => {
  const verify = await fixture(context);
  await assert.rejects(
    verify({ [LEAF]: AFTER, "src/lib/helper/index.ts": "export const value = 2;" }),
    /Protected structural source/u,
  );
});

void test("cuts cannot be introduced in candidate or bypassed by another protected import", async (context) => {
  const verify = await fixture(context);
  await assert.rejects(
    verify({ [LEAF]: AFTER, [MOUNT]: `${ADAPTER}\n` }),
    /mount remain immutable/u,
  );
  const other = await fixture(context, {
    [PAGE]:
      'import { Mount } from "@/components/shell/Mount"; import { Renderer } from "@/components/shell/Renderer"; export default function Page() { return <><Mount /><Renderer /></>; }',
  });
  await assert.rejects(other({ [LEAF]: AFTER }), /bypassed by another protected edge/u);
  const action = await fixture(context, {
    [ACTION]:
      'import { Renderer } from "@/components/shell/Renderer"; export async function save() { "use server"; return Renderer.name; }',
  });
  await assert.rejects(action({ [LEAF]: AFTER }), /admitted SSR mount/u);
  const api = await fixture(context, {
    [API]:
      'import { Renderer } from "@/components/shell/Renderer"; export function GET() { return Response.json(Renderer.name); }',
  });
  await assert.rejects(api({ [LEAF]: AFTER }), /admitted SSR mount/u);
});

void test("cuts require exact named JSX binding usage and an explicit client renderer", async (context) => {
  const verify = await fixture(context);
  await assert.rejects(
    verify({ [LEAF]: AFTER }, [{ ...CUTS[0], bindings: [{ name: "Renderer", local: "Wrong" }] }]),
    /exact import bindings/u,
  );
  await assert.rejects(
    verify({ [LEAF]: AFTER.replace('"use client"; ', "") }),
    /named client renderer/u,
  );
  await assert.rejects(
    verify({ [LEAF]: AFTER.replace("export function Renderer", "function Renderer") }),
    /named client renderer/u,
  );
  const value = await fixture(context, { [MOUNT]: `${ADAPTER}\nexport const hidden = { View };` });
  await assert.rejects(value({ [LEAF]: AFTER }), /only render an island component as JSX/u);
  const repeated = await fixture(context, { [MOUNT]: `${ADAPTER}\nimport "./Renderer";` });
  await assert.rejects(repeated({ [LEAF]: AFTER }), /exact named runtime bindings/u);
});

void test("protected stylesheet retains local import and Tailwind reference edges", async (context) => {
  const verify = await fixture(context, {
    [MOUNT]: `import "./Mount.module.css"; ${ADAPTER}`,
    [STYLE]: '@import "./SSR.module.css";\n@reference "./Reference.module.css";',
    [NESTED_STYLE]: ".safe { color: red; }",
    [REFERENCED_STYLE]: ".referenced { color: red; }",
  });
  for (const path of [NESTED_STYLE, REFERENCED_STYLE]) {
    await assert.rejects(
      verify({ [LEAF]: AFTER, [path]: ".safe { color: blue; }" }),
      /Protected structural source/u,
    );
  }
});
