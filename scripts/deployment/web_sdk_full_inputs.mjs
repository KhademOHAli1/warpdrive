/** Source inventory for a full release using the isolated Web SDK recipe. */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { builtinModules } from "node:module";
import { isAbsolute, join } from "node:path";
import ts from "typescript";
import { discoverBuildGraphs, selectBuildEntries } from "../build-workers.mjs";
import { canonical, generateComponentInputs } from "./component_inputs.mjs";
import { guardWebInputs } from "./web_inputs.mjs";
import { createWebGitSourceReader, readWebGitTree, runWebGit } from "./web_presentation_policy.mjs";

const BACKEND = ["worker", "realtime", "migrator"];
const PROFILE = "warpdrive-web-ui-sdk-beta1-hoisted-v1";
const RECIPE = "deploy/images/Web.Dockerfile";
const SIDECAR_MANIFEST = "tools/web-ui/package.json";
const SIDECAR_LOCK = "tools/web-ui/bun.lock";
// Same reviewed Git blobs and raw SHA-256s as web_extension_inputs.py.
const REVIEWED = {
  [RECIPE]: [
    "d88bc605f5a900c1cdb4c9397060594311fed786",
    "4f20572a0097ab74c008f4666b4b24e45b856a4ce7f5bbef61aa1e23cbda9eec",
  ],
  [SIDECAR_MANIFEST]: [
    "e8fa268ffcad83549914dd5fda020ef4f0215911",
    "09ead474d329be4d9226a42bb61fe9fb970acba4f23fa5fac9b1737d50f13132",
  ],
  [SIDECAR_LOCK]: [
    "d46e02d61eda1184b96645b971be2501d6d677c0",
    "b569a2c43b0914012d6a480ef09c6ec699223e5574ebb344a02eac3854374f8a",
  ],
};
const SDK = ["@ui-sdk/core", "@ui-sdk/react"];
const SDK_IMPORTS = new Set(["@ui-sdk/react/menu", "@ui-sdk/react/dialog", "@ui-sdk/react/drawer"]);
const BUILTINS = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
const SCRIPT = /\.[cm]?[jt]sx?$/u;

export class WebSdkFullInputError extends Error {}

function fail(message) {
  throw new WebSdkFullInputError(message);
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function verifyCheckout(root, revision) {
  if (
    runWebGit(root, ["rev-parse", "--show-prefix"]).toString("ascii") !== "\n" ||
    runWebGit(root, ["rev-parse", "HEAD"]).toString("ascii") !== `${revision}\n`
  )
    fail("Exact SDK discovery checkout and source revision required");
  runWebGit(root, ["diff", "--no-ext-diff", "--no-textconv", "--quiet", "HEAD", "--"]);
}

function pinnedInputs(root, files) {
  const records = {};
  const sources = {};
  for (const [path, [blob, sha256]] of Object.entries(REVIEWED)) {
    const entry = files.get(path);
    if (entry?.mode !== "100644" || entry.blob !== blob || entry.bytes > 64 * 1024)
      fail(`Unreviewed isolated Web SDK input ${path}`);
    const raw = runWebGit(root, ["cat-file", "blob", blob], { maxBuffer: 64 * 1024 });
    if (raw.length !== entry.bytes || digest(raw) !== sha256)
      fail(`Changed isolated Web SDK input ${path}`);
    records[path] = { gitBlob: blob, sha256, bytes: entry.bytes };
    sources[path] = raw.toString("utf8");
  }
  return { records, sources };
}

function parseLock(path, source) {
  const parsed = ts.parseConfigFileTextToJson(path, source);
  if (parsed.error || !parsed.config?.packages) fail(`Invalid locked dependency input ${path}`);
  return parsed.config;
}

function lockedPackageCandidates(lock) {
  const candidates = new Map();
  for (const [key, row] of Object.entries(lock.packages)) {
    const identity = row?.[0];
    if (!Array.isArray(row) || typeof identity !== "string" || identity.lastIndexOf("@") <= 0)
      fail(`Invalid production package lock entry ${key}`);
    const name = identity.slice(0, identity.lastIndexOf("@"));
    for (const alias of new Set([key, name])) {
      if (!candidates.has(alias)) candidates.set(alias, []);
      candidates.get(alias).push(row);
    }
  }
  return candidates;
}

function packageDependencies(row, candidates) {
  const metadata = row[2] ?? {};
  const peers = Object.keys({ ...metadata.optionalDependencies, ...metadata.peerDependencies });
  return [
    ...Object.keys(metadata.dependencies ?? {}),
    ...peers.filter((name) => candidates.has(name)),
  ];
}

function lockedProductionPackages(manifest, lock) {
  const candidates = lockedPackageCandidates(lock);
  const pending = Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies });
  const names = new Set();
  while (pending.length) {
    const name = pending.pop();
    if (names.has(name)) continue;
    const rows = candidates.get(name);
    if (!rows?.length || names.size >= 10_000) fail(`Unbounded production dependency ${name}`);
    names.add(name);
    for (const row of rows) pending.push(...packageDependencies(row, candidates));
  }
  return Object.fromEntries([...names].map((name) => [name, true]));
}

function webDependencies(read, sources, baseImage) {
  const manifest = JSON.parse(read("package.json"));
  const lock = parseLock("bun.lock", read("bun.lock"));
  const extension = JSON.parse(sources[SIDECAR_MANIFEST]);
  const extensionLock = parseLock(SIDECAR_LOCK, sources[SIDECAR_LOCK]);
  if (!sources[RECIPE].split("\n").includes(`FROM ${baseImage} AS base`))
    fail("Web and backend immutable base images differ");
  for (const name of SDK) {
    if (
      ["dependencies", "optionalDependencies", "peerDependencies", "devDependencies"].some((key) =>
        Object.hasOwn(manifest[key] ?? {}, name),
      ) ||
      Object.entries(lock.packages).some(
        ([key, row]) =>
          key === name ||
          key.endsWith(`/${name}`) ||
          (typeof row?.[0] === "string" && row[0].startsWith(`${name}@`)),
      )
    )
      fail("Web SDK package entered the root manifest or lock");
  }
  for (const name of ["react", "react-dom", "scheduler"]) {
    if (
      lock.packages[name] === undefined ||
      canonical(lock.packages[name]) !== canonical(extensionLock.packages[name])
    )
      fail(`Web SDK shared runtime lock differs for ${name}`);
  }
  const rootProduction = lockedProductionPackages(manifest, lock);
  if (!["react", "react-dom", "scheduler"].every((name) => Object.hasOwn(rootProduction, name)))
    fail("The Web SDK shared runtimes must already be root production packages");
  const effectiveManifest = { ...manifest, dependencies: { ...manifest.dependencies } };
  const effectiveLock = { ...lock, packages: { ...lock.packages } };
  for (const name of SDK) {
    effectiveManifest.dependencies[name] = extension.dependencies[name];
    effectiveLock.packages[name] = extensionLock.packages[name];
  }
  return {
    manifest: effectiveManifest,
    lock: effectiveLock,
    production: { ...rootProduction, ...Object.fromEntries(SDK.map((name) => [name, true])) },
  };
}

function checkedSdkImports(path, read) {
  if (!SCRIPT.test(path) || path.endsWith(".d.ts")) return [];
  const tree = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true);
  const imports = new Set();
  const first = tree.statements[0];
  const client =
    first &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === "use client";
  function visit(node) {
    if (ts.isStringLiteralLike(node) && node.text.startsWith("@ui-sdk/")) {
      if (
        !client ||
        !SDK_IMPORTS.has(node.text) ||
        !ts.isImportDeclaration(node.parent) ||
        node.parent.moduleSpecifier !== node ||
        !node.parent.importClause?.namedBindings ||
        !ts.isNamedImports(node.parent.importClause.namedBindings)
      )
        fail(`Unreviewed Web SDK import in ${path}`);
      imports.add(node.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return [...imports].sort();
}

function checkHelperEdge(edge, graphInputs, production) {
  if (edge.external !== true) {
    if (!Object.hasOwn(graphInputs, edge.path)) fail("Unresolved Web helper input");
    return;
  }
  const specifier = edge.path;
  if (BUILTINS.has(specifier)) return;
  const name = specifier
    .split("/")
    .slice(0, specifier.startsWith("@") ? 2 : 1)
    .join("/");
  if (!Object.hasOwn(production, name) || SDK.includes(name) || /[\\:]/u.test(specifier))
    fail(`Unreviewed external Web helper package ${name}`);
}

function helperInputPaths(graphs, production) {
  const paths = new Set();
  for (const { entry, metafile } of graphs) {
    if (!Object.hasOwn(metafile.inputs, entry.in)) fail("Missing Web helper entrypoint");
    for (const [path, input] of Object.entries(metafile.inputs)) {
      paths.add(path);
      for (const edge of input.imports) checkHelperEdge(edge, metafile.inputs, production);
    }
  }
  if (paths.size > 10_000) fail("Web helper input count exceeded");
  return [...paths].sort();
}

async function verifyWorkingInput(root, files, path, expected) {
  const entry = files.get(path);
  if (!entry || entry.bytes > 32 * 1024 * 1024 || (expected && entry.bytes !== expected.bytes))
    fail(`Untracked or changed executable input ${path}`);
  let absolute = root;
  for (const directory of path.split("/").slice(0, -1)) {
    absolute = join(absolute, directory);
    if (!(await lstat(absolute)).isDirectory()) fail(`Unsafe executable input directory ${path}`);
  }
  const full = join(root, path);
  const handle = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size !== entry.bytes) fail(`Changed executable input ${path}`);
    const data = Buffer.alloc(entry.bytes + 1);
    let length = 0;
    while (length < data.length) {
      const { bytesRead } = await handle.read(data, length, data.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const after = await handle.stat();
    const current = await lstat(full);
    const blob = createHash("sha1")
      .update(`blob ${entry.bytes}\0`)
      .update(data.subarray(0, length))
      .digest("hex");
    if (
      length !== entry.bytes ||
      blob !== entry.blob ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      current.dev !== after.dev ||
      current.ino !== after.ino ||
      (expected && digest(data.subarray(0, length)) !== expected.sha256)
    )
      fail(`Executable input differs from the selected Git blob ${path}`);
  } finally {
    await handle.close();
  }
}

/**
 * Run the legacy backend discovery unchanged and separately inventory SDK Web
 * source. Use the returned Git digest with a track-only build context and the
 * pinned recipe. The SDK install, actual builds, smoke and publication require
 * their own evidence. Run in an owned exact checkout without concurrent edits.
 */
export async function generateWebSdkFullInputs({ root, revision, baseImage, platform, buildArgs }) {
  if (
    typeof root !== "string" ||
    !isAbsolute(root) ||
    (await realpath(root)) !== root ||
    typeof revision !== "string" ||
    !/^[0-9a-f]{40}$/u.test(revision)
  )
    fail("Exact canonical SDK discovery root and source revision required");
  verifyCheckout(root, revision);
  const files = readWebGitTree(root, revision);
  if (files.has(`${RECIPE}.dockerignore`)) fail("Unreviewed SDK Docker context override");
  const { records, sources } = pinnedInputs(root, files);
  const read = createWebGitSourceReader(root, files);
  const dependencies = webDependencies(read, sources, baseImage);
  const helperEntries = selectBuildEntries("web");
  const reachable = await guardWebInputs({
    root,
    files: [...files.keys()],
    read,
    helperEntries,
    ...dependencies,
    fail,
  });
  const sdkImports = Object.fromEntries(
    reachable.flatMap((path) => {
      const imports = checkedSdkImports(path, read);
      return imports.length ? [[path, imports]] : [];
    }),
  );
  const backendInputs = await generateComponentInputs({
    root,
    components: BACKEND,
    baseImage,
    platform,
    buildArgs,
  });
  const helperGraphInputs = helperInputPaths(
    await discoverBuildGraphs("web", { root }),
    dependencies.production,
  );
  const nonBrowserGraph = new Set([
    ...helperGraphInputs,
    ...BACKEND.flatMap((name) => backendInputs.components[name].graphInputs),
  ]);
  for (const path of nonBrowserGraph) {
    if (checkedSdkImports(path, read).length)
      fail(`Web SDK entered an executable non-browser graph ${path}`);
  }
  const backendFiles = new Map();
  for (const name of BACKEND) {
    for (const record of backendInputs.components[name].inputs) {
      const existing = backendFiles.get(record.path);
      if (existing !== undefined && canonical(existing) !== canonical(record))
        fail("Conflicting backend inputs");
      backendFiles.set(record.path, record);
    }
  }
  for (const path of new Set([...helperGraphInputs, ...backendFiles.keys()]))
    await verifyWorkingInput(root, files, path, backendFiles.get(path));
  verifyCheckout(root, revision);
  const gitInventory = Object.fromEntries(
    [...files].map(([path, { mode, blob }]) => [path, [mode, "blob", blob]]),
  );
  const web = {
    profile: PROFILE,
    context: backendInputs.context,
    gitInventorySha256: digest(canonical(gitInventory)),
    pinnedInputs: records,
    helperEntries,
    helperGraphInputs,
    sdkImports,
    staticWebInputCount: reachable.length,
  };
  return {
    schemaVersion: 1,
    kind: "warpdrive-web-sdk-full-inputs",
    sourceRevision: revision,
    backendInputs,
    web: { ...web, inputSha256: digest(canonical(web)) },
    deploymentAuthorized: false,
  };
}
