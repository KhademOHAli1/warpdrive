/** Compare the protected first-party source graph under exact, reviewed renderer cuts. */
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
import ts from "typescript";
import { canonical } from "./component_inputs.mjs";
import {
  inspectWebProjectionSnapshot,
  verifyProjectionRendererBindings,
} from "./web_functional_source.mjs";
import { readWebGitTree, runWebGit } from "./web_presentation_policy.mjs";

const REVISION = /^[a-f0-9]{40}$/u;
const BINDING = /^[A-Z][a-zA-Z0-9_]{0,63}$/u;
const TSX = /^src\/(?:app|components|features)\/[A-Za-z0-9_./()@[\]-]+\.tsx$/u;
const APP_ENTRY =
  /^(?:page|layout|loading|error|global-error|global-not-found|not-found|template|default|route|forbidden|unauthorized|robots|sitemap|manifest|favicon|icon\d*|apple-icon\d*|opengraph-image\d*|twitter-image\d*)\.[cm]?[jt]sx?$/u;
const HARD_ROOT =
  /^(?:src\/(?:server|db|config|jobs|entrypoints|trpc|pages)\/|src\/features\/(?:auth|security)\/|src\/features\/[^/]+\/(?:server|actions|routers|jobs)\/|src\/app\/(?:.*\/)?(?:api|auth|oauth|\(auth\))\/|(?:src\/)?(?:middleware|proxy|instrumentation(?:-client|\.node)?)\.|src\/app\/(?:.*\/)?(?:route|robots|sitemap|manifest|favicon|icon\d*|apple-icon\d*|opengraph-image\d*|twitter-image\d*)\.)/u;
const CONFIG_ROOT =
  /^(?:\.dockerignore$|\.env(?:\.|$)|next\.config\.|(?:postcss|tailwind)\.config\.|tsconfig(?:\.|$)|package\.json$|bun\.lock$|bunfig\.toml$|tools\/web-ui\/|patches\/|deploy\/images\/)/u;
const NONRUNTIME = /\.(?:test|spec|stories|d)\.[cm]?[jt]sx?$/u;
const CLIENT_RENDERER =
  /^src\/(?:components\/|features\/[A-Za-z0-9_-]+\/ui\/|app\/\(app\)\/)[A-Za-z0-9_./()@[\]-]+\.tsx$/u;
const SERVER_IMPORTS = new Set(["server-only", "next/headers", "next/server"]);
const SDK = /^@ui-sdk\//u;
const hash = (value) => createHash("sha256").update(canonical(value)).digest("hex");
const order = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right));

export class WebProtectedProjectionError extends Error {}

function reject(message) {
  throw new WebProtectedProjectionError(message);
}

function exact(value, keys) {
  return (
    value &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).sort().join(",") === keys
  );
}

function sorted(list) {
  return list.every((value, index) => index === 0 || order(list[index - 1], value) < 0);
}

function safePath(value, pattern) {
  return (
    typeof value === "string" &&
    value.length <= 240 &&
    pattern.test(value) &&
    !value.split("/").some((part) => ["", ".", ".."].includes(part))
  );
}

function edgeKey(from, to) {
  return `${from}\0${to}`;
}

function checkedCuts(cuts) {
  if (!Array.isArray(cuts) || cuts.length > 128)
    reject("Bounded structural renderer cuts required");
  for (const cut of [...cuts]) {
    if (
      !exact(cut, "bindings,from,to") ||
      !safePath(cut.from, TSX) ||
      !safePath(cut.to, CLIENT_RENDERER) ||
      cut.from === cut.to ||
      !Array.isArray(cut.bindings) ||
      cut.bindings.length < 1 ||
      cut.bindings.length > 16
    )
      reject("Exact structural renderer cut required");
    for (const binding of [...cut.bindings]) {
      if (
        !exact(binding, "local,name") ||
        typeof binding.name !== "string" ||
        !BINDING.test(binding.name) ||
        typeof binding.local !== "string" ||
        !BINDING.test(binding.local)
      )
        reject("Exact named structural renderer binding required");
    }
    if (
      new Set(cut.bindings.map(({ local }) => local)).size !== cut.bindings.length ||
      !sorted(cut.bindings.map(({ name, local }) => edgeKey(name, local)))
    )
      reject("Structural renderer bindings must be unique and sorted");
  }
  if (
    !sorted(cuts.map(({ from, to }) => edgeKey(from, to))) ||
    Buffer.byteLength(canonical(cuts)) > 64 * 1024
  )
    reject("Structural renderer cuts must be unique, sorted and bounded");
  return cuts;
}

function clientDirective(tree) {
  const first = tree.statements[0];
  return (
    first &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === "use client"
  );
}

function namedRenderer(tree, name) {
  const matching = tree.statements.filter(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === name,
  );
  const [node] = matching;
  return (
    matching.length === 1 &&
    node.body &&
    !node.asteriskToken &&
    node.modifiers?.length === 1 &&
    node.modifiers[0].kind === ts.SyntaxKind.ExportKeyword
  );
}

function importBindings(reference) {
  const node = reference.node;
  if (reference.targets.length !== 1 || !node || !ts.isImportDeclaration(node))
    reject("A structural renderer cut requires one exact static import target");
  const clause = node.importClause;
  const named = clause?.namedBindings;
  if (
    !clause ||
    clause.isTypeOnly ||
    clause.name ||
    node.attributes ||
    !named ||
    !ts.isNamedImports(named) ||
    !named.elements.length ||
    named.elements.some((item) => item.isTypeOnly)
  )
    reject("A structural renderer cut requires exact named runtime bindings");
  return named.elements.map((item) => ({
    name: (item.propertyName ?? item.name).text,
    local: item.name.text,
  }));
}

function referencesByPath(references) {
  const rows = new Map();
  for (const reference of references) {
    if (!rows.has(reference.from)) rows.set(reference.from, []);
    rows.get(reference.from).push(reference);
  }
  return rows;
}

function hardRoots(files, snapshot) {
  const roots = new Set([...snapshot.protectedRoots].filter((path) => !NONRUNTIME.test(path)));
  for (const path of files.keys()) {
    if (!NONRUNTIME.test(path) && (HARD_ROOT.test(path) || CONFIG_ROOT.test(path))) roots.add(path);
  }
  return roots;
}

function followClosure(snapshot, roots, cuts = new Set()) {
  const seen = new Set();
  const stack = [...roots];
  while (stack.length) {
    const path = stack.pop();
    if (seen.has(path)) continue;
    seen.add(path);
    for (const target of snapshot.edges.get(path) ?? []) {
      if (!cuts.has(edgeKey(path, target))) stack.push(target);
    }
  }
  return seen;
}

function verifyCuts(snapshot, cuts, references, nonRenderer) {
  const verified = [];
  for (const cut of cuts) {
    const { from, to, bindings } = cut;
    const mount = snapshot.projectionTrees.get(from);
    const renderer = snapshot.projectionTrees.get(to);
    if (
      !mount ||
      !renderer ||
      clientDirective(mount) ||
      !clientDirective(renderer) ||
      nonRenderer.has(from) ||
      nonRenderer.has(to) ||
      !bindings.every(({ name }) => namedRenderer(renderer, name))
    )
      reject(
        `Structural renderer cut must join an admitted SSR mount to a named client renderer: ${from} -> ${to}`,
      );
    const matched = (references.get(from) ?? []).filter((entry) => entry.targets.includes(to));
    const observed = matched
      .flatMap(importBindings)
      .sort((a, b) => order(edgeKey(a.name, a.local), edgeKey(b.name, b.local)));
    if (canonical(observed) !== canonical(bindings))
      reject(`Structural renderer cut does not match the exact import bindings: ${from} -> ${to}`);
    verifyProjectionRendererBindings(mount, from, matched);
    verified.push(edgeKey(from, to));
  }
  return new Set(verified);
}

function sourcePathRoots(snapshot, files, cuts) {
  const hard = hardRoots(files, snapshot);
  const nonRenderer = followClosure(snapshot, hard);
  const roots = new Set([...hard, "src/app/globals.css"]);
  for (const reference of snapshot.references) {
    // Framework imports identify protected SSR roots without forbidding an exact JSX cut below them.
    if (SERVER_IMPORTS.has(reference.specifier) && !NONRUNTIME.test(reference.from))
      roots.add(reference.from);
  }
  for (const path of files.keys()) {
    if (path.startsWith("src/app/") && APP_ENTRY.test(path.split("/").at(-1))) roots.add(path);
  }
  // Mounts must be independently reachable without treating a cut endpoint as a root.
  const references = referencesByPath(snapshot.references);
  const excluded = verifyCuts(snapshot, cuts, references, nonRenderer);
  const reachable = followClosure(snapshot, roots, excluded);
  for (const { from, to } of cuts) {
    if (!reachable.has(from) || reachable.has(to))
      reject(
        `Structural renderer cut is bypassed by another protected edge or root: ${from} -> ${to}`,
      );
  }
  return { reachable, roots, references };
}

function verifyReference(reference) {
  const { specifier, targets, from } = reference;
  if (
    (specifier.startsWith(".") || specifier.startsWith("@/")) &&
    (targets.length === 0 || specifier.includes("\\") || /[?#%]/u.test(specifier))
  )
    reject(`Unresolved or opaque protected local reference: ${from} -> ${specifier}`);
  if (SDK.test(specifier)) reject(`Protected source reaches Web SDK directly: ${from}`);
}

function projection(snapshot, files, cuts) {
  const { reachable, roots, references } = sourcePathRoots(snapshot, files, cuts);
  const records = [];
  for (const path of [...reachable].sort(order)) {
    const file = files.get(path);
    if (!file) reject(`Missing protected structural source root: ${path}`);
    const edges = (references.get(path) ?? []).map((reference) => {
      verifyReference(reference);
      return { specifier: reference.specifier, targets: reference.targets };
    });
    records.push({ ...file, edges });
  }
  const guarded = new Set(snapshot.guarded);
  for (const { from, to } of cuts) {
    if (!guarded.has(from) || !guarded.has(to))
      reject(`Structural renderer cut is outside the pinned Web source guard: ${from} -> ${to}`);
  }
  return { roots: [...roots].sort(order), records };
}

/**
 * The caller authenticates both revisions and independently reviews the cuts.
 * This proves only the protected source projection. Client mutation safety,
 * runtime dependency equivalence, native tests and release admission are separate.
 */
export async function verifyWebProtectedProjection({
  root,
  baselineRevision,
  currentRevision,
  rendererCuts,
}) {
  if (
    typeof root !== "string" ||
    !isAbsolute(root) ||
    root !== realpathSync(root) ||
    runWebGit(root, ["rev-parse", "--show-prefix"]).toString("ascii") !== "\n" ||
    ![baselineRevision, currentRevision].every(
      (revision) => typeof revision === "string" && REVISION.test(revision),
    ) ||
    baselineRevision === currentRevision
  )
    reject("Canonical Git root and two distinct structural revisions required");
  const cuts = checkedCuts(rendererCuts);
  runWebGit(root, ["merge-base", "--is-ancestor", baselineRevision, currentRevision]);
  const before = readWebGitTree(root, baselineRevision);
  const after = readWebGitTree(root, currentRevision);
  for (const { from, to } of cuts) {
    if (
      before.get(from)?.mode !== "100644" ||
      after.get(from)?.mode !== "100644" ||
      before.get(from)?.blob !== after.get(from)?.blob ||
      before.get(to)?.mode !== "100644" ||
      after.get(to)?.mode !== "100644"
    )
      reject(
        `A structural renderer cut must preexist and its mount remain immutable: ${from} -> ${to}`,
      );
  }
  const endpoints = new Set(cuts.flatMap(({ from, to }) => [from, to]));
  const old = projection(await inspectWebProjectionSnapshot(root, before, endpoints), before, cuts);
  const next = projection(await inspectWebProjectionSnapshot(root, after, endpoints), after, cuts);
  const protectedProjectionSha256 = hash(old);
  if (protectedProjectionSha256 !== hash(next))
    reject("Protected structural source blobs, roots or resolved edges differ");
  return {
    schemaVersion: 1,
    kind: "warpdrive-web-protected-source-projection",
    baselineRevision,
    currentRevision,
    rendererCutsSha256: hash(cuts),
    protectedProjectionSha256,
    protectedRoots: next.roots.length,
    protectedFiles: next.records.length,
    deploymentAuthorized: false,
  };
}
