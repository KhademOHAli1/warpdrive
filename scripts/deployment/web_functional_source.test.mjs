import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { selectBuildEntries } from "../build-workers.mjs";
import { verifyWebFunctionalSource } from "./web_functional_source.mjs";
import { WEB_SOURCE_RULES } from "./web_inputs.mjs";

const MENU = "src/components/shell/LocalMenu.tsx";
const CHILD = "src/components/shell/MenuCopy.tsx";
const STYLE = "src/components/shell/menu.module.css";
const ADAPTER = "src/components/shell/MenuView.tsx";
const API = "src/app/api/example/route.ts";
const READ = "src/server/read.ts";
const manifest = "tools/web-ui/package.json";
const lock = "tools/web-ui/bun.lock";
const INTEGRITY = {
  "@ui-sdk/core":
    "sha512-sWsZW8RN6Gviir7REQYuDIafm9hierHQE31OJ+2g+1Pp3lDVKp/dk0+0dxFvqOQRmBveRvlE9FiARgNlQ9dMFw==",
  "@ui-sdk/react":
    "sha512-7wcUsZI+WoG2uo3N+PHrWntk97qI9ez2cUrHV9H507FiL118Pi4tuhWUCMDtWwEUCNQLybpBm1QRLkEXVOPAUg==",
};
const SDK_VERSION = "0.1.0-beta.1";
const CSS = ".menu { display: flex; gap: 8px; }";
const OLD = `
"use client";
import { MenuCopy } from "./MenuCopy";
import styles from "./menu.module.css";
export function LocalMenu() {
  return <div className={styles.menu}><MenuCopy /></div>;
}
`;
const NEXT = `
"use client";
import { type KeyboardEvent, useRef, useState } from "react";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@ui-sdk/react/menu";
import { MenuCopy } from "./MenuCopy";
import styles from "./menu.module.css";
export function LocalMenu() {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  return <div className={styles.menu}>
    <button type="button" ref={button} aria-expanded={open} onKeyDown={(event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        button.current?.focus();
      }
    }}><MenuCopy /></button>
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger>Show options</MenuTrigger>
      <MenuContent><MenuItem onClick={() => setOpen(false)}>Close</MenuItem></MenuContent>
    </Menu>
  </div>;
}
`;
const profile = { version: 1, modules: [MENU, CHILD], styles: [STYLE], adapters: [ADAPTER] };

async function fixture(context, source = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "wd-functional-")));
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
  async function put(path, bytes) {
    const file = join(root, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, bytes);
  }
  async function commit(changes) {
    for (const [path, contents] of Object.entries(changes)) await put(path, contents);
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
    ...Object.fromEntries(selectBuildEntries("all").map(({ in: path }) => [path, "export {};"])),
    "package.json": '{"name":"fixture","dependencies":{"react":"19.3.1"}}',
    "bun.lock": '{"packages":{"react":["react@19.3.1"]}}',
    "next.config.ts": "export default {};",
    "tsconfig.json":
      '{"compilerOptions":{"paths":{"@/*":["./src/*"]},"moduleResolution":"bundler"}}',
    "src/app/globals.css": `@import "tailwindcss";\n${WEB_SOURCE_RULES.join("\n")}`,
    "src/app/page.tsx": 'export { MenuView as default } from "@/components/shell/MenuView";',
    [manifest]: JSON.stringify({
      name: "warpdrive-web-ui",
      private: true,
      packageManager: "bun@1.4.4",
      dependencies: Object.fromEntries(Object.keys(INTEGRITY).map((name) => [name, SDK_VERSION])),
    }),
    [lock]: JSON.stringify({
      packages: Object.fromEntries(
        Object.entries(INTEGRITY).map(([name, integrity]) => [
          name,
          [`${name}@${SDK_VERSION}`, "", {}, integrity],
        ]),
      ),
    }),
    [API]: 'export { GET } from "@/server/read";',
    [READ]: "export const GET = () => Response.json({ enabled: true });",
    [ADAPTER]:
      'import { LocalMenu } from "./LocalMenu"; export const MenuView = () => <LocalMenu />;',
    [CHILD]: '"use client"; export const MenuCopy = () => <span>Settings</span>;',
    [MENU]: OLD,
    [STYLE]: CSS,
    ...source,
  });
  function verify(currentRevision, overrides = {}) {
    return verifyWebFunctionalSource({
      root,
      baselineRevision,
      currentRevision,
      profile,
      ...overrides,
    });
  }
  return { root, baselineRevision, git, put, commit, verify };
}

void test("exact committed keyboard, focus, state and isolated SDK edits admit source eligibility", async (context) => {
  const f = await fixture(context);
  const revision = await f.commit({ [MENU]: NEXT, [STYLE]: CSS.replace("8px", "12px") });
  await f.put(READ, "export const dirtyCheckout = true;");
  const result = await f.verify(revision);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.kind, "warpdrive-web-functional-source");
  assert.equal(result.baselineRevision, f.baselineRevision);
  assert.equal(result.currentRevision, revision);
  assert.equal(result.deploymentAuthorized, false);
  assert.deepEqual(
    result.changed.map(({ path }) => path),
    [MENU, STYLE],
  );
  for (const digest of [
    result.profileSha256,
    result.protectedSourceSha256,
    result.protectedGraphSha256,
  ])
    assert.match(digest, /^[a-f0-9]{64}$/u);
  assert.deepEqual(
    await f.verify(revision, { profile: { ...profile, modules: [CHILD, MENU] } }),
    result,
  );
});

void test("mutation channels, arbitrary runtime access and unsafe render constructs fail closed", async (context) => {
  const f = await fixture(context);
  const attempts = [
    ['return <div>{fetch("/api")}</div>;', /Ambient|Unreviewed presentation call/u],
    ['return <form action="/mutate">Send</form>;', /Unreviewed presentation element/u],
    ["return <button>Submit</button>;", /explicit non-submit/u],
    [
      'return <button type="button" formAction="/api">Submit</button>;',
      /Unreviewed presentation attribute/u,
    ],
    [
      'return <button type="button" onClick={() => document.body.click()}>Run</button>;',
      /Indirect or unreviewed presentation call/u,
    ],
    [
      'return <div className="bg-[url(https://example.invalid)]">Run</div>;',
      /compiler directive|class expression/u,
    ],
    [
      'return <div dangerouslySetInnerHTML={{ __html: "bad" }} />;',
      /Unreviewed presentation attribute/u,
    ],
    [
      'return <div>{import("@/server/read")}</div>;',
      /reaches protected application source|Indirect or unreviewed presentation call/u,
    ],
    ['return <div>{globalThis["fetch"]}</div>;', /ElementAccessExpression/u],
    ["return <div>{data.run()}</div>;", /Indirect or unreviewed presentation call/u],
    [
      'return <button type="button" onClick={data.run}>Run</button>;',
      /locally|local state setter/u,
    ],
    ["return <div {...data} />;", /Spread or nonliteral/u],
    ['return <a href="/api">Link</a>;', /Unreviewed presentation element/u],
    ["return <div>{data.constructor}</div>;", /Unreviewed presentation property/u],
    ["for (data.value of [1]) {} return <div />;", /ForOfStatement/u],
  ];
  for (const [body, reason] of attempts) {
    const revision = await f.commit({
      [MENU]: `"use client"; import { MenuCopy } from "./MenuCopy"; import styles from "./menu.module.css"; export function LocalMenu(data: { run: () => void }) { const _ = <div className={styles.menu}><MenuCopy /></div>; ${body} }`,
    });
    await assert.rejects(f.verify(revision), reason, body);
  }
});

void test("immutable server, protected runtime closure and raw outside SDK imports are fenced", async (context) => {
  const blocked = [
    { [API]: 'export { GET } from "@/server/read"; import "@/components/shell/MenuView";' },
    { "src/entrypoints/worker.ts": 'import "@/components/shell/MenuView";' },
    { "src/features/example/reader.ts": '"use server"; import "@/components/shell/MenuView";' },
    {
      "src/app/page.tsx":
        'import "./helpers"; export { MenuView as default } from "@/components/shell/MenuView";',
      "src/app/helpers.ts": 'import "@/components/shell/LocalMenu";',
    },
    {
      "src/features/example/read.ts": 'export type Props = import("@ui-sdk/react/menu").MenuProps;',
    },
  ];
  for (const changes of blocked) {
    const f = await fixture(context, changes);
    const revision = await f.commit({ [MENU]: NEXT });
    await assert.rejects(
      f.verify(revision),
      /Protected server, route or runtime closure|Unreviewed ingress|Web SDK import outside/u,
    );
  }
});

void test("adapters can render an island binding but cannot call, leak or re-export it", async (context) => {
  for (const adapter of [
    'import { LocalMenu } from "./LocalMenu"; export const MenuView = () => LocalMenu() ? <p>Write</p> : null;',
    'import { LocalMenu } from "./LocalMenu"; export const MenuView = () => <div>{LocalMenu}</div>;',
    'export { LocalMenu as MenuView } from "./LocalMenu";',
  ]) {
    const f = await fixture(context, { [ADAPTER]: adapter });
    const revision = await f.commit({ [MENU]: NEXT });
    await assert.rejects(f.verify(revision), /Adapter may only render|Adapter may import only/u);
  }
});

void test("raw CSS, JSDoc and triple-slash edges cannot enter an island through an unreviewed file", async (context) => {
  const outside = "src/components/shell/";
  for (const changes of [
    { [`${outside}unrelated.css`]: '@import url("./menu.module.css");' },
    { [`${outside}unrelated.css`]: '@reference "./menu.module.css";' },
    { [`${outside}unrelated.ts`]: '/// <reference path="LocalMenu.tsx" />\nexport {};' },
    { [`${outside}unrelated.js`]: '/** @import { LocalMenu } from "./LocalMenu" */\nexport {};' },
  ]) {
    const f = await fixture(context, changes);
    const revision = await f.commit({ [MENU]: NEXT });
    await assert.rejects(f.verify(revision), /Unreviewed ingress/u);
  }
});

void test("protected input changes and new source membership cannot masquerade as presentation", async (context) => {
  const f = await fixture(context);
  for (const changes of [
    { [READ]: "export const GET = () => Response.json({ enabled: false });" },
    {
      [ADAPTER]:
        'import { LocalMenu } from "./LocalMenu"; export const MenuView = () => <main><LocalMenu /></main>;',
    },
    { [lock]: "{}" },
  ]) {
    const revision = await f.commit({ [MENU]: NEXT, ...changes });
    await assert.rejects(f.verify(revision), /Protected source bytes changed/u);
    f.git("reset", "--hard", f.baselineRevision);
  }
  const revision = await f.commit({
    [MENU]: NEXT,
    "src/components/shell/new.ts": "export const extra = true;",
  });
  await assert.rejects(f.verify(revision), /Git source membership changed/u);
});

void test("checked SDK integrity, exact surface imports and stylesheet resource guards", async (context) => {
  const missing = await fixture(context, { [lock]: "{}" });
  const candidate = await missing.commit({ [MENU]: NEXT });
  await assert.rejects(missing.verify(candidate), /Unreviewed Web SDK version or integrity/u);

  const f = await fixture(context);
  const wrong = await f.commit({ [MENU]: NEXT.replace("@ui-sdk/react/menu", "@ui-sdk/core/menu") });
  await assert.rejects(f.verify(wrong), /Unreviewed presentation import/u);
  for (const style of [
    ".menu { color: image-set(url(/api)); }",
    '@import "/api";',
    "body { display: none; }",
  ]) {
    const revision = await f.commit({ [MENU]: NEXT, [STYLE]: style });
    await assert.rejects(f.verify(revision), /Unreviewed functional stylesheet syntax/u);
  }
});

void test("focus refs can attach only to native DOM elements", async (context) => {
  const f = await fixture(context);
  const revision = await f.commit({
    [MENU]: NEXT.replace("<MenuTrigger>", "<MenuTrigger ref={button}>"),
  });
  await assert.rejects(f.verify(revision), /Presentation ref must be locally owned/u);
});

void test("mutable leaves require an explicit client boundary", async (context) => {
  const f = await fixture(context);
  const revision = await f.commit({ [MENU]: NEXT.replace('"use client";', "") });
  await assert.rejects(f.verify(revision), /explicit client directive/u);
});

void test("orphan adapters and profiles that declare sensitive or duplicate paths reject", async (context) => {
  const f = await fixture(context, {
    "src/app/page.tsx": "export default function Page() { return null; }",
  });
  const revision = await f.commit({ [MENU]: NEXT });
  await assert.rejects(f.verify(revision), /reachable from reviewed Web roots/u);
  for (const bad of [
    { ...profile, modules: [API] },
    { ...profile, adapters: [ADAPTER, ADAPTER] },
    { ...profile, adapters: [MENU] },
    { ...profile, modules: ["src/components/../components/LocalMenu.tsx"] },
  ])
    await assert.rejects(f.verify(revision, { profile: bad }), /Invalid exact|disjoint/u);
});

void test("full application Git tree admits a reviewed isolated renderer without mutating its real checkout", {
  timeout: 60_000,
}, async (context) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "wd-functional-full-")));
  context.after(() => rm(root, { recursive: true, force: true }));
  const source = await realpath(fileURLToPath(new URL("../..", import.meta.url)));
  function git(cwd, ...args) {
    return execFileSync(
      "git",
      ["--no-replace-objects", "-c", "core.hooksPath=/dev/null", ...args],
      {
        cwd,
        env: {
          PATH: process.env.PATH,
          LC_ALL: "C",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
        },
        timeout: 15_000,
        maxBuffer: 1024 * 1024,
      },
    )
      .toString("utf8")
      .trimEnd();
  }
  const base = git(source, "rev-parse", "HEAD");
  git(root, "init", "-q");
  const objects = git(source, "rev-parse", "--path-format=absolute", "--git-path", "objects");
  await writeFile(join(root, ".git/objects/info/alternates"), `${objects}\n`, { flag: "wx" });
  git(root, "read-tree", base);
  async function addObject(path, content) {
    const leaf = join(root, path);
    await mkdir(dirname(leaf), { recursive: true });
    await writeFile(leaf, content);
    const blob = git(root, "hash-object", "-w", "--no-filters", "--", path);
    git(root, "update-index", "--add", "--cacheinfo", `100644,${blob},${path}`);
  }
  function commitTree(parent, message) {
    return git(
      root,
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit-tree",
      git(root, "write-tree"),
      "-p",
      parent,
      "-m",
      message,
    );
  }
  await addObject(
    "src/app/functional-policy-fixture/page.tsx",
    'export { MenuView as default } from "@/components/shell/MenuView";',
  );
  await addObject(
    ADAPTER,
    'import { LocalMenu } from "./LocalMenu"; export const MenuView = () => <LocalMenu />;',
  );
  await addObject(CHILD, '"use client"; export const MenuCopy = () => <span>Settings</span>;');
  await addObject(MENU, OLD);
  await addObject(STYLE, CSS);
  const fullProfile = JSON.parse(git(source, "show", `${base}:scripts/deployment/web-functional-profile.json`));
  const fixtureProfile = {
    version: 1,
    modules: [...profile.modules, ...fullProfile.modules].sort(),
    styles: [...profile.styles, ...fullProfile.styles].sort(),
    adapters: [...profile.adapters, ...fullProfile.adapters].sort(),
  };
  const baselineRevision = commitTree(base, "Synthetic reviewed adapter and island");
  const keyboardOnly = NEXT.replace(/import \{ Menu,.*\n/u, "").replace(
    / {4}<Menu open=.*?<\/Menu>\n/su,
    "",
  );
  await addObject(MENU, keyboardOnly);
  const currentRevision = commitTree(baselineRevision, "Synthetic local keyboard interaction");
  const result = await verifyWebFunctionalSource({
    root,
    baselineRevision,
    currentRevision,
    profile: fixtureProfile,
  });
  assert.ok(result.guardedWebPathCount > 1000);
  assert.deepEqual(
    result.changed.map(({ path }) => path),
    [MENU],
  );
  assert.equal(result.deploymentAuthorized, false);
});
