/**
 * V1 source classification for an independently reviewed Web presentation profile.
 * The caller owns the reviewed profile, exact revision authority and release
 * qualification. This module reads Git objects only. It does not qualify an
 * image, prove retained component inputs or authorize deployment.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
import postcss from "postcss";
import ts from "typescript";
import { selectBuildEntries } from "../build-workers.mjs";
import { canonical } from "./component_inputs.mjs";
import { guardWebInputs } from "./web_inputs.mjs";

const VERSION = 1;
const MAX_TREE_FILES = 20_000;
const MAX_TREE_BYTES = 256 * 1024 * 1024;
const MAX_BLOB_BATCH_BYTES = 96 * 1024 * 1024;
const MAX_PRESENTATION_FILES = 128;
const MAX_PRESENTATION_BYTES = 128 * 1024;
const REVISION = /^[0-9a-f]{40}$/u;
const SOURCE = /\.(?:[cm]?[jt]sx?|css|json|patch)$/u;
const CSS_PATH =
  /^(?:src\/app\/globals\.css|src\/(?:components|features)\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.module\.css)$/iu;
const COPY_PATH =
  /^src\/(?:components\/(?:[a-z0-9_-]+\/)*|features\/[a-z0-9_-]+\/ui\/)(?:messages\/[a-z0-9_-]+\.(?:de|en|fa)\.json)$/iu;
const COMPONENT_PATH =
  /^src\/(?:components\/(?:[a-z0-9_-]+\/)*|features\/[a-z0-9_-]+\/ui\/(?:[a-z0-9_-]+\/)*)[a-z0-9_-]+\.tsx$/iu;
const COPY_KEY = /^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*){0,7}$/u;
const CSS_PROPERTIES = new Set([
  "background-color",
  "border-color",
  "border-radius",
  "color",
  "column-gap",
  "font-size",
  "gap",
  "height",
  "margin",
  "margin-block",
  "margin-inline",
  "max-height",
  "max-width",
  "min-height",
  "min-width",
  "padding",
  "padding-block",
  "padding-inline",
  "row-gap",
  "width",
]);
const COLORS = new Set(["background-color", "border-color", "color"]);
const JSX_TAGS = new Set([
  "article",
  "aside",
  "button",
  "div",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "label",
  "li",
  "main",
  "nav",
  "p",
  "section",
  "span",
  "strong",
  "td",
  "th",
]);
const JSX_ATTRIBUTES = new Set(["aria-label", "className", "title"]);
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export class WebPresentationError extends Error {}

function fail(reason) {
  throw new WebPresentationError(reason);
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function comparePath(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function git(root, args, { input, maxBuffer = 8 * 1024 * 1024 } = {}) {
  const result = spawnSync(
    "git",
    ["--no-pager", "--no-replace-objects", "-c", "core.fsmonitor=false", ...args],
    {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        LC_ALL: "C",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_OPTIONAL_LOCKS: "0",
        GIT_NO_LAZY_FETCH: "1",
        GIT_TERMINAL_PROMPT: "0",
      },
      input,
      maxBuffer,
      timeout: 30_000,
      killSignal: "SIGKILL",
    },
  );
  if (result.error || result.status !== 0 || !Buffer.isBuffer(result.stdout))
    fail("Exact Git source could not be read or revisions are unrelated");
  return result.stdout;
}

function safePath(path) {
  return (
    path.length <= 512 &&
    !path.includes("\\") &&
    !/\p{Cc}/u.test(path) &&
    !path.split("/").some((part) => ["", ".", "..", ".git", "node_modules"].includes(part))
  );
}

function readTree(root, revision) {
  if (
    git(root, ["rev-parse", "--verify", `${revision}^{commit}`]).toString("ascii") !==
    `${revision}\n`
  )
    fail("Exact Git commit required");
  const raw = utf8.decode(git(root, ["ls-tree", "-rlz", "--full-tree", revision]));
  if (!raw.endsWith("\0")) fail("Incomplete Git source tree");
  const entries = new Map();
  let bytes = 0;
  for (const row of raw.slice(0, -1).split("\0")) {
    const fields = /^(100644|100755) blob ([0-9a-f]{40}) +([0-9]+)\t(.+)$/u.exec(row);
    if (!fields || !safePath(fields[4]) || entries.has(fields[4]))
      fail("Git source contains an unsafe, duplicate or non-regular path");
    const [, mode, blob, size, path] = fields;
    const length = Number(size);
    bytes += length;
    if (entries.size >= MAX_TREE_FILES || bytes > MAX_TREE_BYTES)
      fail("Git source tree exceeds its budget");
    entries.set(path, { path, mode, blob, bytes: length });
  }
  return entries;
}

function sourceReader(root, entries) {
  // Read known source formats in one Git process. A graph read outside this
  // inventory fails closed. The full Git tree is still part of protected proof.
  const blobs = new Map();
  let bytes = 0;
  for (const entry of entries.values()) {
    if (!(SOURCE.test(entry.path) || entry.path === "bun.lock") || blobs.has(entry.blob)) continue;
    bytes += entry.bytes + 100;
    if (bytes > MAX_BLOB_BATCH_BYTES) fail("Git source blob batch exceeds its budget");
    blobs.set(entry.blob, entry.bytes);
  }
  const raw = git(root, ["cat-file", "--batch"], {
    input: `${[...blobs.keys()].join("\n")}\n`,
    maxBuffer: MAX_BLOB_BATCH_BYTES,
  });
  const offsets = new Map();
  let offset = 0;
  for (const [blob, length] of blobs) {
    const header = `${blob} blob ${length}\n`;
    const start = offset + header.length;
    const end = start + length;
    if (raw.toString("ascii", offset, start) !== header || raw[end] !== 10)
      fail("Git source blob inventory differs");
    offsets.set(blob, { start, end });
    offset = end + 1;
  }
  if (offset !== raw.length) fail("Unexpected Git source blob output");
  return (path) => {
    const entry = entries.get(path);
    const span = entry && offsets.get(entry.blob);
    if (!span) fail(`Unreviewed Web source read: ${path}`);
    try {
      return utf8.decode(raw.subarray(span.start, span.end));
    } catch {
      fail(`Invalid UTF-8 Web source: ${path}`);
    }
  };
}

function reviewedPaths(table, pathPattern, rule, kind) {
  if (!table || Object.getPrototypeOf(table) !== Object.prototype)
    fail("Invalid presentation profile");
  return Object.entries(table).map(([path, values]) => {
    if (
      !pathPattern.test(path) ||
      !safePath(path) ||
      !Array.isArray(values) ||
      !values.length ||
      values.length > 64 ||
      new Set(values).size !== values.length ||
      values.some((value) => typeof value !== "string" || !rule(value))
    )
      fail(`Invalid reviewed ${kind} path or field`);
    return { path, kind, fields: [...values].sort(comparePath) };
  });
}

function profileRules(profile) {
  if (
    !profile ||
    Object.getPrototypeOf(profile) !== Object.prototype ||
    Object.keys(profile).sort().join(",") !== "components,copy,styles,version" ||
    profile.version !== VERSION
  )
    fail("Unsupported presentation profile");
  const rules = [
    ...reviewedPaths(profile.styles, CSS_PATH, (field) => CSS_PROPERTIES.has(field), "style"),
    ...reviewedPaths(profile.copy, COPY_PATH, (field) => COPY_KEY.test(field), "copy"),
    ...reviewedPaths(
      profile.components,
      COMPONENT_PATH,
      (field) => field === "text" || JSX_ATTRIBUTES.has(field),
      "component",
    ),
  ].sort((left, right) => comparePath(left.path, right.path));
  if (!rules.length || rules.length > MAX_PRESENTATION_FILES)
    fail("Bounded reviewed presentation profile required");
  return rules;
}

function plainText(value) {
  return (
    value.trim().length > 0 && Buffer.byteLength(value) <= 512 && !/[\p{Cc}<>{}&]/u.test(value)
  );
}

function styleValue(property, value) {
  if (COLORS.has(property)) return /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/iu.test(value);
  return /^(?:0|[0-9]{1,4}px)$/u.test(value) && Number.parseInt(value, 10) <= 1024;
}

function styleSpans(source, rule) {
  let stylesheet;
  try {
    stylesheet = postcss.parse(source, { from: rule.path });
  } catch {
    fail(`Invalid reviewed stylesheet: ${rule.path}`);
  }
  const spans = [];
  stylesheet.walkDecls((declaration) => {
    const { prop, value, important, raws } = declaration;
    if (
      !rule.fields.includes(prop) ||
      important ||
      !styleValue(prop, value) ||
      !/^:[ \t]*$/u.test(raws.between ?? "")
    )
      return;
    const start = declaration.source.start.offset + prop.length + raws.between.length;
    if (source.slice(start, start + value.length) === value)
      spans.push({ start, end: start + value.length });
  });
  return spans;
}

function copySpans(source, rule) {
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    fail(`Invalid reviewed locale catalog: ${rule.path}`);
  }
  const tree = ts.parseJsonText(rule.path, source);
  if (
    tree.parseDiagnostics.length ||
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  )
    fail(`Invalid reviewed locale catalog: ${rule.path}`);
  const spans = [];
  function inspect(node, parents) {
    if (!ts.isObjectLiteralExpression(node)) return;
    const names = new Set();
    for (const property of node.properties) {
      if (
        !ts.isPropertyAssignment(property) ||
        !ts.isStringLiteral(property.name) ||
        names.has(property.name.text)
      )
        fail(`Ambiguous locale catalog key: ${rule.path}`);
      names.add(property.name.text);
      const keys = [...parents, property.name.text];
      const path = keys.join(".");
      if (
        rule.fields.includes(path) &&
        keys.length === path.split(".").length &&
        ts.isStringLiteral(property.initializer) &&
        plainText(property.initializer.text)
      )
        spans.push({
          start: property.initializer.getStart(tree),
          end: property.initializer.getEnd(),
        });
      else if (rule.fields.some((field) => field.startsWith(`${path}.`)))
        inspect(property.initializer, keys);
    }
  }
  inspect(tree.statements[0].expression, []);
  if (spans.length !== rule.fields.length) fail(`Reviewed plain locale key missing: ${rule.path}`);
  return spans;
}

function intrinsicTag(name) {
  return ts.isIdentifier(name) && JSX_TAGS.has(name.text);
}

function componentSpans(source, rule) {
  const tree = ts.createSourceFile(
    rule.path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  if (tree.parseDiagnostics.length) fail(`Invalid reviewed JSX module: ${rule.path}`);
  const spans = [];
  function inspect(node) {
    if (
      ts.isExpressionStatement(node) &&
      ts.isStringLiteral(node.expression) &&
      node.expression.text === "use server"
    )
      fail(`Server action cannot be reviewed as presentation: ${rule.path}`);
    if (
      rule.fields.includes("text") &&
      ts.isJsxText(node) &&
      ts.isJsxElement(node.parent) &&
      intrinsicTag(node.parent.openingElement.tagName) &&
      plainText(node.text)
    )
      spans.push({ start: node.getFullStart(), end: node.getEnd() });
    if (
      ts.isJsxAttribute(node) &&
      ts.isIdentifier(node.name) &&
      rule.fields.includes(node.name.text) &&
      intrinsicTag(node.parent.parent.tagName) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer)
    ) {
      const value = node.initializer.text;
      const allowed =
        node.name.text === "className"
          ? /^[a-zA-Z0-9_:-]+(?: [a-zA-Z0-9_:-]+)*$/u.test(value) && value.length <= 512
          : plainText(value);
      if (allowed)
        spans.push({ start: node.initializer.getStart(tree), end: node.initializer.getEnd() });
    }
    ts.forEachChild(node, inspect);
  }
  inspect(tree);
  return spans;
}

const EXTRACT = { style: styleSpans, copy: copySpans, component: componentSpans };

function skeleton(source, rule) {
  const spans = EXTRACT[rule.kind](source, rule).sort((left, right) => left.start - right.start);
  const protectedSlices = [];
  let cursor = 0;
  for (const { start, end } of spans) {
    if (start < cursor || end <= start || end > source.length) fail("Invalid presentation span");
    protectedSlices.push(source.slice(cursor, start));
    cursor = end;
  }
  protectedSlices.push(source.slice(cursor));
  return digest(canonical(protectedSlices));
}

function graphPackages(manifest, lock) {
  if (
    !manifest ||
    typeof manifest !== "object" ||
    !lock.packages ||
    typeof lock.packages !== "object"
  )
    fail("Exact Web package inputs required");
  // The immutable lock is a package-name bound for first-party loader checks.
  // It does not establish package resolution or production install equivalence.
  const names = Object.values(lock.packages).map((row) => {
    const match =
      Array.isArray(row) &&
      typeof row[0] === "string" &&
      /^((?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+)@./iu.exec(row[0]);
    if (!match) fail("Unreviewed locked package identity");
    return [match[1], true];
  });
  return Object.fromEntries(names);
}

async function inspectSnapshot(root, entries, rules) {
  const read = sourceReader(root, entries);
  let manifest;
  try {
    manifest = JSON.parse(read("package.json"));
  } catch {
    fail("Invalid exact Web dependency manifest");
  }
  const parsedLock = ts.parseConfigFileTextToJson("bun.lock", read("bun.lock"));
  if (parsedLock.error) fail("Invalid exact Web dependency lock");
  const presentation = new Map();
  for (const rule of rules) {
    const entry = entries.get(rule.path);
    if (entry?.mode !== "100644" || entry.bytes > MAX_PRESENTATION_BYTES)
      fail(`Reviewed presentation file must be a bounded existing regular blob: ${rule.path}`);
    presentation.set(rule.path, skeleton(read(rule.path), rule));
  }
  const reachability = await guardWebInputs({
    root,
    files: [...entries.keys()],
    read,
    helperEntries: selectBuildEntries("web"),
    manifest,
    lock: parsedLock.config,
    production: graphPackages(manifest, parsedLock.config),
    fail,
  });
  const protectedSource = [...entries.values()]
    .sort((left, right) => comparePath(left.path, right.path))
    .map((row) =>
      presentation.has(row.path)
        ? { path: row.path, mode: row.mode, presentationSkeletonSha256: presentation.get(row.path) }
        : row,
    );
  return { protectedSource, reachability };
}

/**
 * Inspect two immutable commits. Profiles admit static edits only to explicit
 * existing files. Every other Git path, mode and object remains protected,
 * including sources beyond Next's reviewed first-party reachability.
 */
export async function verifyWebPresentation({ root, baselineRevision, currentRevision, profile }) {
  if (
    typeof root !== "string" ||
    !isAbsolute(root) ||
    root !== realpathSync(root) ||
    git(root, ["rev-parse", "--show-prefix"]).toString("ascii") !== "\n" ||
    ![baselineRevision, currentRevision].every(
      (revision) => typeof revision === "string" && REVISION.test(revision),
    ) ||
    baselineRevision === currentRevision
  )
    fail("Canonical Git root and two distinct exact revisions required");
  const rules = profileRules(profile);
  git(root, ["merge-base", "--is-ancestor", baselineRevision, currentRevision]);
  const baseline = readTree(root, baselineRevision);
  const current = readTree(root, currentRevision);
  const allowed = new Map(rules.map((rule) => [rule.path, rule.kind]));
  const changed = [];
  for (const [path, entry] of baseline) {
    const after = current.get(path);
    if (!after || entry.mode !== after.mode)
      fail(`Protected source membership or mode changed: ${path}`);
    if (entry.blob === after.blob) continue;
    const kind = allowed.get(path);
    if (!kind) fail(`Protected source bytes changed: ${path}`);
    changed.push({ path, kind, baselineBlob: entry.blob, currentBlob: after.blob });
  }
  if (baseline.size !== current.size || !changed.length)
    fail("An existing reviewed presentation file must change without changing source membership");
  const before = await inspectSnapshot(root, baseline, rules);
  const after = await inspectSnapshot(root, current, rules);
  const protectedSourceSha256 = digest(canonical(before.protectedSource));
  if (protectedSourceSha256 !== digest(canonical(after.protectedSource)))
    fail("Protected presentation structure changed");
  const guardedWebPathsSha256 = digest(canonical(before.reachability));
  if (guardedWebPathsSha256 !== digest(canonical(after.reachability)))
    fail("Protected Web source reachability changed");
  const reachable = new Set(before.reachability);
  if (changed.some(({ path }) => !reachable.has(path)))
    fail("Changed presentation file is outside the guarded Web source graph");
  return {
    schemaVersion: VERSION,
    kind: "warpdrive-web-presentation-source",
    profileSha256: digest(canonical({ version: VERSION, rules })),
    baselineRevision,
    currentRevision,
    protectedSourceSha256,
    guardedWebPathsSha256,
    guardedWebPathCount: before.reachability.length,
    changed: changed.sort((left, right) => comparePath(left.path, right.path)),
    deploymentAuthorized: false,
  };
}
