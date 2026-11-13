import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { selectBuildEntries } from "../build-workers.mjs";
import { WEB_SOURCE_RULES } from "./web_inputs.mjs";
import { verifyWebPresentation } from "./web_presentation_policy.mjs";

const CSS = "src/components/shell/TopBar.module.css";
const COPY = "src/components/shell/messages/topBar.en.json";
const VIEW = "src/components/shell/TopBar.tsx";
const API = "src/app/api/example/route.ts";
const SERVER = "src/server/read.ts";
const CSS_SOURCE = ".top { gap: 24px; color: #fff; }\n";
const COPY_SOURCE = '{"labels":{"greeting":"Welcome","count":"{count} items"}}\n';
const VIEW_SOURCE = [
  '"use client";',
  'import "./TopBar.module.css";',
  'import { labels } from "./messages/topBar.en.json";',
  'export const TopBar = () => <div className="top" title="Welcome">Overview <span>{labels.greeting}</span></div>;',
].join("\n");
const profile = {
  version: 1,
  styles: { [CSS]: ["gap", "color"] },
  copy: { [COPY]: ["labels.greeting"] },
  components: { [VIEW]: ["text", "title", "className"] },
};

async function fixture(context) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "wd-presentation-")));
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
    ...Object.fromEntries(selectBuildEntries("web").map(({ in: path }) => [path, "export {};"])),
    "package.json": '{"name":"fixture","dependencies":{}}',
    "bun.lock": '{"packages":{}}',
    "next.config.ts": "export default {};",
    "tsconfig.json":
      '{"compilerOptions":{"paths":{"@/*":["./src/*"]},"moduleResolution":"bundler"}}',
    "src/app/globals.css": `@import "tailwindcss";\n${WEB_SOURCE_RULES.join("\n")}`,
    "src/app/page.tsx": 'export { TopBar as default } from "@/components/shell/TopBar";',
    [API]: 'export { GET } from "@/server/read";',
    [SERVER]: "export const GET = () => Response.json({ enabled: true });",
    [CSS]: CSS_SOURCE,
    [COPY]: COPY_SOURCE,
    [VIEW]: VIEW_SOURCE,
  });
  function verify(currentRevision, overrides = {}) {
    return verifyWebPresentation({
      root,
      baselineRevision,
      currentRevision,
      profile,
      ...overrides,
    });
  }
  return { root, baselineRevision, git, put, commit, verify };
}

void test("exact Git presentation changes keep the protected tree and fresh Web paths fixed", async (context) => {
  const f = await fixture(context);
  const current = await f.commit({
    [CSS]: CSS_SOURCE.replace("24px", "20px").replace("#fff", "#112233"),
    [COPY]: COPY_SOURCE.replace("Welcome", "Willkommen"),
    [VIEW]: VIEW_SOURCE.replace('className="top"', 'className="top flex"')
      .replace('title="Welcome"', 'title="Hello"')
      .replace("Overview ", "Pipeline "),
  });
  // Reading source objects remains deterministic even if the checkout is dirty.
  await f.put(SERVER, "export const changedInCheckout = true;");
  const result = await f.verify(current);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.baselineRevision, f.baselineRevision);
  assert.equal(result.currentRevision, current);
  assert.equal(result.deploymentAuthorized, false);
  assert.match(result.profileSha256, /^[0-9a-f]{64}$/u);
  assert.match(result.protectedSourceSha256, /^[0-9a-f]{64}$/u);
  assert.match(result.guardedWebPathsSha256, /^[0-9a-f]{64}$/u);
  assert.ok(result.guardedWebPathCount > 10);
  assert.deepEqual(
    result.changed.map(({ path, kind }) => [path, kind]),
    [
      [CSS, "style"],
      [VIEW, "component"],
      [COPY, "copy"],
    ],
  );
  assert.deepEqual(await f.verify(current), result);
});

void test("new routes and changes to protected transitive server and manifest bytes reject", async (context) => {
  const changes = [
    { [SERVER]: "export const GET = () => Response.json({ enabled: false });" },
    { [API]: "export const POST = () => new Response();" },
    { "src/app/api/unknown/route.ts": "export const GET = () => new Response();" },
    { "src/instrumentation.ts": "export const register = () => {};" },
    { "package.json": '{"name":"fixture","dependencies":{"@ui-sdk/core":"0.1.0"}}' },
    { "bun.lock": '{"packages":{"@ui-sdk/core":["@ui-sdk/core@0.1.0"]}}' },
    { "scripts/auth-operator.ts": "export const changed = true;" },
    { "next.config.ts": "export default { pageExtensions: ['new'] };" },
  ];
  for (const changed of changes) {
    const f = await fixture(context);
    const revision = await f.commit({ [CSS]: CSS_SOURCE.replace("24px", "22px"), ...changed });
    await assert.rejects(f.verify(revision), /Protected source|source membership/u);
  }
});

void test("guard discovers API, helper, metadata and implicit middleware roots before granting admission", async (context) => {
  for (const path of [API, "src/app/icon2.tsx", "src/proxy.ts", "scripts/auth-operator.ts"]) {
    const f = await fixture(context);
    const baselineRevision = await f.commit({ [path]: 'import "@/missing";' });
    const revision = await f.commit({ [CSS]: CSS_SOURCE.replace("24px", "22px") });
    await assert.rejects(f.verify(revision, { baselineRevision }), /unresolved local edge/u, path);
  }
});

void test("an unreferenced reviewed file is insufficient presentation evidence", async (context) => {
  const f = await fixture(context);
  const old = await f.commit({
    [VIEW]: VIEW_SOURCE.replace('import "./TopBar.module.css";\n', ""),
  });
  const current = await f.commit({ [CSS]: CSS_SOURCE.replace("24px", "22px") });
  await assert.rejects(
    f.verify(current, { baselineRevision: old }),
    /outside the guarded Web source graph/u,
  );
});

void test("JSX data, effects, imports, actions, links and custom-component props stay fixed", async (context) => {
  const changes = [
    `${VIEW_SOURCE}\nexport { write } from "@/server/write";`,
    VIEW_SOURCE.replace("Overview ", "{sendAction()} "),
    VIEW_SOURCE.replace('title="Welcome"', "onClick={sendAction}"),
    VIEW_SOURCE.replace("Overview ", '<a href="/logout">Logout</a>'),
    VIEW_SOURCE.replace('className="top"', 'className="bg-[url(https://example.invalid/pixel)]"'),
    VIEW_SOURCE.replace('<div className="top"', '<div {...extra} className="top"'),
    VIEW_SOURCE.replace(
      "<span>{labels.greeting}</span>",
      '<Widget aria-label="Changed">{labels.greeting}</Widget>',
    ),
    VIEW_SOURCE.replace('"use client";', '"use server";'),
  ];
  const f = await fixture(context);
  for (const source of changes) {
    const revision = await f.commit({ [VIEW]: source });
    await assert.rejects(
      f.verify(revision),
      /Protected presentation|unresolved local edge|Server action/u,
    );
  }
  const custom = VIEW_SOURCE.replace(
    "<span>{labels.greeting}</span>",
    '<Widget title="Original" />',
  );
  const old = await f.commit({ [VIEW]: custom });
  const next = await f.commit({ [VIEW]: custom.replace('title="Original"', 'title="Changed"') });
  await assert.rejects(f.verify(next, { baselineRevision: old }), /Protected presentation/u);
});

void test("stylesheet loader, selector, unsafe values and copy contract changes reject", async (context) => {
  const f = await fixture(context);
  const cases = [
    { [CSS]: CSS_SOURCE.replace("24px", "url(https://example.invalid/pixel)") },
    { [CSS]: CSS_SOURCE.replace("#fff", "var(--not-reviewed)") },
    { [CSS]: CSS_SOURCE.replace("24px", "22px !important") },
    { [CSS]: CSS_SOURCE.replace(".top", ".other") },
    { [CSS]: `${CSS_SOURCE}@import "other-package";` },
    { [COPY]: COPY_SOURCE.replace("Welcome", "{name}") },
    { [COPY]: COPY_SOURCE.replace("Welcome", "<b>Welcome</b>") },
    { [COPY]: COPY_SOURCE.replace("{count} items", "{count} rows") },
    { [COPY]: '{"labels":{"greeting":"One","greeting":"Two","count":"{count} items"}}' },
  ];
  for (const changed of cases) {
    const current = await f.commit({ [CSS]: CSS_SOURCE, [COPY]: COPY_SOURCE, ...changed });
    await assert.rejects(
      f.verify(current),
      /Protected presentation|reviewed CSS|plain locale|Ambiguous locale/iu,
    );
  }
});

void test("rejects a changed mode, symlink, scope escape and invalid version", async (context) => {
  const f = await fixture(context);
  const current = await f.commit({ [CSS]: CSS_SOURCE.replace("24px", "22px") });
  await assert.rejects(
    f.verify(current, { profile: { ...profile, version: 2 } }),
    /Unsupported presentation profile/u,
  );
  await assert.rejects(
    f.verify(current, {
      profile: { ...profile, components: { [API]: ["text"] } },
    }),
    /Invalid reviewed component/u,
  );
  f.git("update-index", "--chmod=+x", CSS);
  f.git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-qm",
    "Changed mode",
  );
  await assert.rejects(f.verify(f.git("rev-parse", "HEAD")), /membership or mode changed/u);
  await symlink("TopBar.module.css", join(f.root, "src/components/shell/unsafe.css"));
  const unsafe = await f.commit({});
  await assert.rejects(f.verify(unsafe), /non-regular path/u);
  await assert.rejects(f.verify("HEAD"), /two distinct exact revisions/u);
  await assert.rejects(f.verify(current, { baselineRevision: unsafe }), /unrelated/u);
});

void test("the full committed Web application admits reviewed CSS, copy and static JSX", {
  timeout: 60_000,
}, async (context) => {
  const source = await realpath(fileURLToPath(new URL("../..", import.meta.url)));
  const root = await realpath(await mkdtemp(join(tmpdir(), "wd-presentation-full-")));
  context.after(() => rm(root, { recursive: true, force: true }));
  const run = (cwd, args, env = {}) =>
    execFileSync("git", ["--no-replace-objects", "-c", "core.hooksPath=/dev/null", ...args], {
      cwd,
      env: {
        PATH: process.env.PATH,
        LC_ALL: "C",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        ...env,
      },
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
    }).toString("utf8");
  const actualGit = (...args) => run(source, args).trim();
  const privateGit = (...args) => run(root, args).trim();
  const baselineRevision = actualGit("rev-parse", "HEAD");
  privateGit("init", "-q");
  const objects = actualGit("rev-parse", "--path-format=absolute", "--git-path", "objects");
  // A private Git object store and index. Existing immutable blobs are read
  // through an alternate. No real worktree, index or branch is modified.
  await writeFile(join(root, ".git/objects/info/alternates"), `${objects}\n`, { flag: "wx" });
  privateGit("read-tree", baselineRevision);
  const copy = "src/components/data-table/messages/tableControls.en.json";
  const view = "src/components/ui/EmptyState.tsx";
  for (const [path, before, after] of [
    [CSS, "  gap: 24px;", "  gap: 22px;"],
    [copy, '"clearSelection": "Clear selection"', '"clearSelection": "Reset selection"'],
    [
      view,
      'className="text-base font-semibold text-foreground"',
      'className="text-sm font-semibold text-foreground"',
    ],
  ]) {
    const original = run(source, ["show", `${baselineRevision}:${path}`]);
    assert.equal(original.split(before).length, 2, path);
    const leaf = join(root, path);
    await mkdir(dirname(leaf), { recursive: true });
    await writeFile(leaf, original.replace(before, after), { flag: "wx" });
    const blob = privateGit("hash-object", "-w", "--no-filters", "--", path);
    privateGit("update-index", "--cacheinfo", `100644,${blob},${path}`);
  }
  const tree = privateGit("write-tree");
  const currentRevision = privateGit(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit-tree",
    tree,
    "-p",
    baselineRevision,
    "-m",
    "Synthetic presentation-only comparison",
  );
  const proof = await verifyWebPresentation({
    root,
    baselineRevision,
    currentRevision,
    profile: {
      version: 1,
      styles: { [CSS]: ["gap"] },
      copy: { [copy]: ["clearSelection"] },
      components: { [view]: ["className"] },
    },
  });
  assert.equal(proof.deploymentAuthorized, false);
  assert.ok(proof.guardedWebPathCount > 1000);
  assert.deepEqual(
    proof.changed.map(({ path }) => path),
    [copy, CSS, view],
  );
});
