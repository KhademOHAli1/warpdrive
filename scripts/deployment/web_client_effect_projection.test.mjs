import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { selectBuildEntries } from "../build-workers.mjs";
import { verifyWebClientEffectProjection } from "./web_client_effect_projection.mjs";
import { WEB_SOURCE_RULES } from "./web_inputs.mjs";

const MOUNT = "src/app/(app)/page.tsx";
const RENDERER = "src/components/shell/Renderer.tsx";
const OLD_VIEW = "src/components/shell/Detail.tsx";
const NEW_VIEW = "src/components/shell/View.tsx";
const STYLE = "src/components/shell/View.module.css";
const PROVIDER = "src/components/shell/protectedState.tsx";
const DEP = "src/components/shell/protectedSeed.ts";
const CUTS = [{ from: MOUNT, to: RENDERER, bindings: [{ name: "Renderer", local: "Renderer" }] }];
const CAPABILITIES = [
  {
    path: PROVIDER,
    exports: [
      { name: "ProtectedAction", kind: "component" },
      { name: "useCompact", kind: "hook" },
      { name: "useDense", kind: "hook" },
    ],
    consumers: [RENDERER],
  },
];
const PROFILE = {
  version: 1,
  rendererCuts: CUTS,
  beforeModules: [RENDERER],
  afterModules: [RENDERER],
  beforeStyles: [],
  afterStyles: [],
  capabilities: [],
};
const MOUNT_SOURCE =
  'import { Renderer } from "@/components/shell/Renderer"; export default function Page() { return <Renderer title="Fixture" />; }';
const DATA = "{ title }: { title: string }";
const PLAIN = `"use client"; export function Renderer(${DATA}) { return <div>{title}</div>; }`;
const LOCAL = `"use client";
import { useId, useRef, useState } from "react";
import styles from "./View.module.css";
export function Renderer(${DATA}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  function close() { setOpen(false); trigger.current?.focus(); }
  return <div><button type="button" ref={trigger} className={styles.trigger} aria-controls={panelId}
    onClick={() => setOpen(!open)} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); close(); } }}>{title}</button>
    <section id={panelId} hidden={!open}>Panel</section></div>;
}`;
const EFFECTS = `"use client";
import { ProtectedAction, useCompact, useDense } from "./protectedState";
export function Renderer() {
  const compact = useCompact();
  const dense = useDense();
  return <div data-compact={compact} data-dense={dense}><ProtectedAction /></div>;
}`;
const PROVIDER_SOURCE = `"use client";
import { current } from "./protectedSeed";
export function useCompact(): boolean { return current; }
export function useDense(): boolean { return true; }
export function ProtectedAction() { return <button type="button">Existing action</button>; }`;

async function fixture(context, baseline = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "wd-client-effects-")));
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
    for (const [path, text] of Object.entries(changes)) {
      const file = join(root, path);
      await mkdir(dirname(file), { recursive: true });
      if (text === null) await rm(file);
      else await writeFile(file, text);
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
    [MOUNT]: MOUNT_SOURCE,
    [RENDERER]: PLAIN,
    ...baseline,
  });
  return async (changes, profile = PROFILE) => {
    git("checkout", "-q", "--detach", baselineRevision);
    const currentRevision = await commit(changes);
    await writeFile(join(root, RENDERER), 'fetch("https://outside.example.invalid");');
    try {
      return await verifyWebClientEffectProjection({
        root,
        baselineRevision,
        currentRevision,
        profile,
      });
    } finally {
      git("restore", "--", RENDERER);
    }
  };
}

void test("admits local state, keyboard, DOM ref and class changes with the same scalar props", async (context) => {
  const verify = await fixture(context);
  const result = await verify(
    { [RENDERER]: LOCAL, [STYLE]: ".trigger:focus-visible { outline: 2px solid var(--color); }" },
    { ...PROFILE, afterStyles: [STYLE] },
  );
  assert.equal(result.kind, "warpdrive-web-client-effect-projection");
  assert.equal(result.deploymentAuthorized, false);
  assert.equal(result.capabilityUses, 0);
  assert.notEqual(result.baselineSubtreeSha256, result.candidateSubtreeSha256);
  assert.match(result.effectSha256, /^[a-f0-9]{64}$/u);
});

void test("permits a reachable pure view replacement and rejects omitted, orphaned or shadowed targets", async (context) => {
  const wrapper = (module) =>
    `"use client"; import { Detail } from "${module}"; export function Renderer(${DATA}) { return <Detail title={title} />; }`;
  const detail = `"use client"; export function Detail(${DATA}) { return <span>{title}</span>; }`;
  const verify = await fixture(context, { [RENDERER]: wrapper("./Detail"), [OLD_VIEW]: detail });
  const profile = {
    ...PROFILE,
    beforeModules: [OLD_VIEW, RENDERER],
    afterModules: [RENDERER, NEW_VIEW],
  };
  const change = { [RENDERER]: wrapper("./View"), [OLD_VIEW]: null, [NEW_VIEW]: detail };
  assert.equal((await verify(change, profile)).capabilityUses, 0);
  await assert.rejects(
    verify(change, { ...profile, afterModules: [RENDERER] }),
    /crosses the selected subtree/u,
  );
  await assert.rejects(verify({ ...change, [RENDERER]: PLAIN }, profile), /exactly reachable/u);
  await assert.rejects(
    verify({ ...change, "src/components/shell/View/index.tsx": detail }, profile),
    /one exact committed target/u,
  );
});

void test("rejects ambient/network/auth/database/dispatch authority and loaders", async (context) => {
  const verify = await fixture(context);
  const variants = [
    ["", 'fetch("/api/private");', /Unreviewed client call authority/u],
    ["", 'globalThis["fetch"]("/api/private");', /Indirect or unreviewed client call/u],
    ["", 'const send = window.fetch; send("/api/private");', /Unreviewed client property/u],
    ["", 'dispatch({ type: "reauth" });', /Unreviewed client call authority/u],
    ["", 'import("./client");', /Indirect or unreviewed client call/u],
    [
      'import { readFileSync } from "node:fs";',
      'readFileSync("/etc/passwd");',
      /Unreviewed client import authority/u,
    ],
    ['import { db } from "@/db/client";', "db();", /one exact committed target/u],
    [
      'import { useEffect } from "react";',
      "useEffect(() => {});",
      /Unreviewed client import binding/u,
    ],
    ["", 'localStorage.setItem("key", "value");', /Indirect or unreviewed client call/u],
  ];
  for (const [imports, body, reason] of variants) {
    await assert.rejects(
      verify({
        [RENDERER]: `"use client"; ${imports} export function Renderer(${DATA}) { ${body} return <div>{title}</div>; }`,
      }),
      reason,
    );
  }
  await assert.rejects(
    verify({
      [RENDERER]: `"use client"; import { secret } from "@/features/auth/secret"; export function Renderer(${DATA}) { return <div>{title}</div>; }`,
      "src/features/auth/secret.ts": "export const secret = 'opaque';",
    }),
    /crosses the selected subtree/u,
  );
});

void test("refuses native resource dispatch, custom actions, raw class utilities and callable props", async (context) => {
  const verify = await fixture(context);
  for (const [element, reason] of [
    ['<img src="/private" />', /Unreviewed client element/u],
    ['<form action="/private" />', /Unreviewed client element/u],
    ['<button type="submit">Submit</button>', /non-submitting/u],
    [
      '<button type="button" formAction="/private">Submit</button>',
      /Unreviewed client JSX attribute/u,
    ],
    ["<div {...{ hidden: true }} />", /Opaque client JSX attribute/u],
    ['<div className="bg-[url(/private)]" />', /Unreviewed client CSS class/u],
    ["<div dangerouslySetInnerHTML={{ __html: title }} />", /Unreviewed client JSX attribute/u],
  ]) {
    await assert.rejects(
      verify({ [RENDERER]: PLAIN.replace("<div>{title}</div>", element) }),
      reason,
    );
  }
  await assert.rejects(
    verify({ [RENDERER]: PLAIN.replace("title: string", "title: () => void") }),
    /Unreviewed client prop type/u,
  );
  await assert.rejects(
    verify({ [RENDERER]: PLAIN.replace("title: string", "title?: string") }),
    /renderer props contract differs/u,
  );
  await assert.rejects(
    verify({ [MOUNT]: `${MOUNT_SOURCE}\n// changed` }),
    /renderer mount changed/u,
  );
  await assert.rejects(
    verify(
      { [RENDERER]: LOCAL, [STYLE]: ".trigger { background-color: url(/private); }" },
      { ...PROFILE, afterStyles: [STYLE] },
    ),
    /non-resource syntax/u,
  );
});

void test("keeps same terminal zero-argument capabilities ordered and retains provider dependency bytes", async (context) => {
  const mount = MOUNT_SOURCE.replace(' title="Fixture"', "");
  const verify = await fixture(context, {
    [MOUNT]: mount,
    [RENDERER]: EFFECTS,
    [PROVIDER]: PROVIDER_SOURCE,
    [DEP]: "export const current = true;",
  });
  const profile = { ...PROFILE, capabilities: CAPABILITIES };
  const updated = EFFECTS.replace("<div data-compact", '<div className="p-4" data-compact');
  const result = await verify({ [RENDERER]: updated }, profile);
  await assert.rejects(
    verify(
      {
        [RENDERER]: updated.replace(
          "<ProtectedAction />",
          "<span>New sibling</span><ProtectedAction />",
        ),
      },
      profile,
    ),
    /fingerprints differ/u,
  );
  assert.equal(result.capabilityUses, 3);
  assert.match(result.capabilitySourceSha256, /^[a-f0-9]{64}$/u);
  await assert.rejects(
    verify(
      { [RENDERER]: updated.replace("<div className", "<div key={compact} className") },
      profile,
    ),
    /keyed presentation/u,
  );
  await assert.rejects(
    verify(
      {
        [RENDERER]: updated
          .replace("<div className", "<section className")
          .replace("</div>", "</section>"),
      },
      profile,
    ),
    /fingerprints differ/u,
  );
  await assert.rejects(
    verify(
      {
        [RENDERER]: EFFECTS.replace(
          "const compact = useCompact();\n  const dense = useDense();",
          "const dense = useDense();\n  const compact = useCompact();",
        ),
      },
      profile,
    ),
    /fingerprints differ/u,
  );
  await assert.rejects(
    verify(
      {
        [RENDERER]: EFFECTS.replace(
          "<ProtectedAction />",
          "<ProtectedAction /><ProtectedAction />",
        ),
      },
      profile,
    ),
    /Unreviewed functional Web capability use/u,
  );
  await assert.rejects(
    verify(
      { [RENDERER]: EFFECTS.replace("<ProtectedAction />", '<ProtectedAction title={"x"} />') },
      profile,
    ),
    /Unreviewed functional Web capability use/u,
  );
  await assert.rejects(
    verify({ [RENDERER]: updated, [DEP]: "export const current = false;" }, profile),
    /source graph differs/u,
  );
  await assert.rejects(
    verify({ [RENDERER]: updated, [PROVIDER]: `${PROVIDER_SOURCE}\n// changed` }, profile),
    /capability source changed/u,
  );
});
