import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, readFile, realpath } from "node:fs/promises";
import { builtinModules } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildOptionsForEntry,
  discoverBuildGraphs,
  selectBuildEntries,
} from "../build-workers.mjs";

export const COMPONENTS = ["web", "worker", "realtime", "migrator"];
const SHARED = [
  "package.json",
  "bun.lock",
  "bunfig.toml",
  ".dockerignore",
  "tsconfig.json",
  "LICENSE",
  "deploy/images/Dockerfile",
  "scripts/build-workers.mjs",
  "scripts/deployment/component_inputs.mjs",
];
const SHARED_TREES = ["patches", "third-party"];
// These are app assets outside static imports. External npm runtime data stays in the entire
// locked production node_modules layer; it must never be replaced with a package-name-only copy.
const RUNTIME_ASSETS = {
  web: {
    trees: ["public"],
    bundledChildren: ["dist/workflow-code-worker.mjs"],
    helpers: ["dist/next.config.mjs", "dist/sweep-spam.mjs", "dist/auth-operator.mjs"],
  },
  worker: {
    trees: [],
    bundledChildren: ["dist/workflow-code-worker.mjs"],
    helpers: ["dist/sweep-spam.mjs"],
  },
  realtime: { trees: [], bundledChildren: [], helpers: [] },
  migrator: { trees: ["drizzle"], bundledChildren: [], helpers: ["dist/auth-operator.mjs"] },
};
const SKIP_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  ".next",
  ".runtime",
  ".harness",
  ".superpowers",
  ".claude",
  ".vscode",
  ".idea",
  "dist",
  "build",
  "coverage",
  "test-results",
  "__pycache__",
]);
const LIMITS = {
  files: 20_000,
  fileBytes: 32 * 1024 * 1024,
  totalBytes: 256 * 1024 * 1024,
  graphInputs: 10_000,
};
const POLICY_FILES = ["scripts/build-workers.mjs", "scripts/deployment/component_inputs.mjs"];
const BUILTINS = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const WEB_LIMITATIONS = [
  "Conservative repository-source inventory, not a discovered Next production graph.",
  "Includes backend, helper, test and documentation sources conservatively; worker-only Web reuse is not qualified.",
  "Tailwind automatic source discovery and Next instrumentation/type qualification are not isolated; complete release CI remains required.",
];

export class ComponentInputError extends Error {}
const fail = (reason) => {
  throw new ComponentInputError(reason);
};
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const compareUtf8 = (left, right) =>
  Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort(compareUtf8)
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  if (typeof value === "number" && !Number.isSafeInteger(value))
    fail("Canonical input requires safe integer numbers");
  if (!["string", "number", "boolean"].includes(typeof value) && value !== null)
    fail("Invalid canonical input value");
  return JSON.stringify(value);
}
const wellFormed = (value) => Buffer.from(value, "utf8").toString("utf8") === value;
const hasControl = (value) =>
  [...value].some((character) => {
    const code = character.codePointAt(0);
    return code < 32 || code === 127;
  });

function safePath(value) {
  if (
    typeof value !== "string" ||
    !wellFormed(value) ||
    value.length === 0 ||
    isAbsolute(value) ||
    /^[a-zA-Z]:/u.test(value) ||
    value.includes("\\") ||
    hasControl(value)
  )
    fail("Unsafe input path");
  if (value.split("/").some((part) => part === "" || part === "." || part === ".."))
    fail("Escaping input path");
  return value;
}

async function checkedPath(root, relative, directory = false) {
  safePath(relative);
  const segments = relative.split("/");
  let full = root;
  for (const [index, segment] of segments.entries()) {
    full = join(full, segment);
    const stat = await lstat(full);
    if (stat.isSymbolicLink()) fail(`Symlink input rejected: ${relative}`);
    if (index < segments.length - 1 || directory) {
      if (!stat.isDirectory()) fail(`Non-directory input ancestor: ${relative}`);
    } else if (!stat.isFile()) fail(`Non-regular input rejected: ${relative}`);
  }
  return full;
}

async function treeFiles(root, relative, { web = false } = {}) {
  const found = [];
  async function walk(directory) {
    const full = directory === "" ? root : await checkedPath(root, directory, true);
    for (const entry of await readdir(full, { withFileTypes: true })) {
      const name = directory === "" ? entry.name : `${directory}/${entry.name}`;
      safePath(name);
      if (
        web &&
        (SKIP_DIRECTORIES.has(entry.name) ||
          (entry.name.startsWith(".env") && entry.name !== ".env.example") ||
          entry.name.endsWith(".log") ||
          entry.name === ".DS_Store")
      )
        continue;
      if (entry.isDirectory()) await walk(name);
      else {
        await checkedPath(root, name);
        found.push(name);
        if (found.length > LIMITS.files) fail("Input file count exceeded");
      }
    }
  }
  await walk(relative);
  return found.sort(compareUtf8);
}

async function hashFiles(root, paths) {
  const inputs = [];
  let totalBytes = 0;
  const unique = [...new Set(paths)].sort(compareUtf8);
  if (unique.length > LIMITS.files) fail("Input file count exceeded");
  for (const path of unique) {
    const full = await checkedPath(root, path);
    const handle = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.size > LIMITS.fileBytes)
        fail(`Unbounded/non-regular input: ${path}`);
      totalBytes += before.size;
      if (totalBytes > LIMITS.totalBytes) fail("Input byte count exceeded");
      const bytes = await handle.readFile();
      const after = await handle.stat();
      if (
        bytes.length !== before.size ||
        after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs
      )
        fail(`Input changed while hashing: ${path}`);
      inputs.push({ path, sha256: sha256(bytes), bytes: bytes.length });
    } finally {
      await handle.close();
    }
  }
  return inputs;
}

/** @param {unknown} value */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function semanticContext({ baseImage, platform, buildArgs = {} }) {
  if (typeof baseImage !== "string" || !/^oven\/bun@sha256:[a-f0-9]{64}$/u.test(baseImage))
    fail("An immutable oven/bun base digest is required; a mutable tag cannot authorize reuse");
  if (platform !== "linux/amd64")
    fail("Only the qualified native linux/amd64 platform is admitted");
  if (!isRecord(buildArgs)) fail("Invalid build arguments");
  for (const [key, value] of Object.entries(buildArgs)) {
    if (
      !["APP_VERSION", "NEXT_PUBLIC_WS_URL"].includes(key) ||
      typeof value !== "string" ||
      !wellFormed(value) ||
      value.length > 4096 ||
      hasControl(value)
    )
      fail(
        "Unknown or unsafe semantic build argument; source revisions are provenance, never relabeling inputs",
      );
  }
  return {
    baseImage,
    platform,
    buildArgs: {
      APP_VERSION: buildArgs.APP_VERSION ?? "",
      NEXT_PUBLIC_WS_URL: buildArgs.NEXT_PUBLIC_WS_URL ?? "same-origin",
    },
  };
}

function externalPackage(specifier, dependencies) {
  if (BUILTINS.has(specifier)) return;
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("@/") ||
    specifier.includes("\\") ||
    specifier.startsWith("node:")
  )
    fail(`Unresolved or unsafe external application input: ${specifier}`);
  const parts = specifier.split("/");
  const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  if (!Object.hasOwn(dependencies, name))
    fail(`External package is not a declared production dependency: ${name}`);
}

function packageCandidates(packages, name) {
  return Object.entries(packages)
    .filter(([key, value]) => {
      if (key === name) return true;
      const identity = Array.isArray(value) ? value[0] : null;
      return typeof identity === "string" && identity.slice(0, identity.lastIndexOf("@")) === name;
    })
    .map(([, value]) => value);
}

function nextPackageDependencies(candidates, packages) {
  const result = [];
  for (const candidate of candidates) {
    const metadata = candidate[2] ?? {};
    result.push(...Object.keys(metadata.dependencies ?? {}));
    const optional = { ...metadata.optionalDependencies, ...metadata.peerDependencies };
    for (const dependency of Object.keys(optional)) {
      if (packageCandidates(packages, dependency).length > 0) result.push(dependency);
    }
  }
  return result;
}

function productionPackages(manifest, lock) {
  if (!isRecord(lock) || !isRecord(lock.packages)) fail("Invalid locked package inventory");
  const pending = Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies });
  const names = new Set();
  while (pending.length > 0) {
    const name = pending.shift();
    if (names.has(name)) continue;
    names.add(name);
    if (names.size > LIMITS.graphInputs) fail("Production package inventory exceeded");
    const candidates = packageCandidates(lock.packages, name);
    if (candidates.length === 0) fail(`Unresolved locked production package: ${name}`);
    pending.push(...nextPackageDependencies(candidates, lock.packages));
  }
  return Object.fromEntries([...names].map((name) => [name, true]));
}

async function requireBaseRecipe(root, context) {
  const recipe = await readFile(await checkedPath(root, "deploy/images/Dockerfile"), "utf8");
  const stages = new Set();
  for (const line of recipe
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^FROM\b/i.test(line))) {
    const match = /^FROM\s+(\S+)\s+AS\s+([a-z][a-z0-9-]*)$/i.exec(line);
    if (match === null || stages.has(match[2]))
      fail("Unreviewed or ambiguous Dockerfile FROM syntax");
    if (stages.size === 0) {
      if (match[1] !== context.baseImage || match[2] !== "base")
        fail("Declared immutable base does not match the actual fixed Dockerfile base");
    } else if (!stages.has(match[1])) fail("Unreviewed external image stage");
    stages.add(match[2]);
  }
  if (!stages.has("base")) fail("Missing fixed Dockerfile base stage");
}

async function validateGraphInput(root, path, input, metafile, dependencies) {
  await checkedPath(root, safePath(path));
  if (path.split("/").some((part) => SKIP_DIRECTORIES.has(part) || part.startsWith(".env")))
    fail("Generated/private graph input rejected");
  if (!Array.isArray(input.imports)) fail("Invalid graph import inventory");
  for (const imported of input.imports) {
    if (imported.external === true) externalPackage(imported.path, dependencies);
    else if (!Object.hasOwn(metafile.inputs, imported.path))
      fail("Unresolved internal graph input");
  }
}

async function graphInputs(root, component, dependencies) {
  const graphs = await discoverBuildGraphs(component, { root });
  const found = new Set();
  for (const { entry, metafile } of graphs) {
    if (!Object.hasOwn(metafile.inputs, entry.in))
      fail(`Entrypoint absent from graph: ${entry.in}`);
    for (const [path, input] of Object.entries(metafile.inputs)) {
      await validateGraphInput(root, path, input, metafile, dependencies);
      found.add(path);
      if (found.size > LIMITS.graphInputs) fail("Graph input count exceeded");
    }
  }
  if (found.size > LIMITS.graphInputs) fail("Graph input count exceeded");
  return [...found].sort(compareUtf8);
}

async function inventoryPass(root, components) {
  const packagePath = await checkedPath(root, "package.json");
  const manifest = JSON.parse(await readFile(packagePath, "utf8"));
  const dependencies = manifest.dependencies ?? {};
  if (
    Object.values(dependencies).some(
      (version) => typeof version !== "string" || /^(?:file|link|workspace|portal):/u.test(version),
    )
  )
    fail("Local production package dependencies require an explicit input policy");
  if (
    ["preinstall", "install", "postinstall", "prepare"].some(
      (hook) => manifest.scripts?.[hook] !== undefined,
    )
  )
    fail("Root dependency-install lifecycle hooks require an explicit input policy");
  const ts = (await import("typescript")).default;
  const lockPath = await checkedPath(root, "bun.lock");
  const lock = ts.parseConfigFileTextToJson(lockPath, await readFile(lockPath, "utf8"));
  if (lock.error !== undefined) fail("Invalid locked package inventory");
  const production = productionPackages(manifest, lock.config);
  const configPath = await checkedPath(root, "tsconfig.json");
  const config = ts.parseConfigFileTextToJson(configPath, await readFile(configPath, "utf8"));
  if (config.error !== undefined || config.config?.extends !== undefined)
    fail("Unreviewed tsconfig extends/configuration input");
  const shared = [...SHARED];
  for (const tree of SHARED_TREES) shared.push(...(await treeFiles(root, tree)));
  for (const name of await readdir(root))
    if (/^tsconfig(?:\.[a-zA-Z0-9_-]+)?\.json$/u.test(name)) shared.push(name);
  const result = {};
  for (const component of components) {
    const graph = await graphInputs(root, component, production);
    const paths = [...shared, ...graph];
    for (const tree of RUNTIME_ASSETS[component].trees)
      paths.push(...(await treeFiles(root, tree)));
    if (component === "web") paths.push(...(await treeFiles(root, "", { web: true })));
    result[component] = { graphInputs: graph, inputs: await hashFiles(root, paths) };
  }
  return result;
}

export async function generateComponentInputs({
  root = DEFAULT_ROOT,
  components = COMPONENTS,
  ...options
}) {
  if (Object.keys(options).some((key) => !["baseImage", "platform", "buildArgs"].includes(key)))
    fail("Unknown input context option");
  const context = semanticContext(options);
  if (
    !Array.isArray(components) ||
    components.length === 0 ||
    new Set(components).size !== components.length ||
    components.some((component) => !COMPONENTS.includes(component))
  )
    fail("Invalid component selection");
  const selected = COMPONENTS.filter((component) => components.includes(component));
  const projectRoot = await realpath(resolve(root));
  await requireBaseRecipe(projectRoot, context);
  const first = await inventoryPass(projectRoot, selected);
  // A second fresh resolver pass brackets inventory hashing. New imports and concurrent source,
  // config, asset or tree-membership changes reject the entire result instead of stale reuse.
  const second = await inventoryPass(projectRoot, selected);
  if (canonical(first) !== canonical(second))
    fail("Input graph or file inventory changed during discovery");
  await requireBaseRecipe(projectRoot, context);
  const policySources = first[selected[0]].inputs.filter((input) =>
    POLICY_FILES.includes(input.path),
  );
  const policy = {
    version: 1,
    context,
    sharedFiles: SHARED,
    sharedTrees: SHARED_TREES,
    rootTsconfigFiles: true,
    runtimeAssets: RUNTIME_ASSETS,
    limits: LIMITS,
    policySources,
    entries: Object.fromEntries(
      COMPONENTS.map((component) => [component, selectBuildEntries(component)]),
    ),
    esbuild: {
      ...buildOptionsForEntry(selectBuildEntries("realtime")[0], "/"),
      absWorkingDir: "<root>",
      discovery: { metafile: true, write: false, logLevel: "silent" },
    },
    web: {
      mode: "conservative-repository-sources-not-next-graph",
      excludedNames: [...SKIP_DIRECTORIES].sort(),
      excludedFiles: [".env* except .env.example", "*.log", ".DS_Store"],
    },
    revision: "excluded-provenance-original-image-source-must-be-preserved",
  };
  const inputPolicySha256 = sha256(canonical(policy));
  const result = {};
  for (const component of selected) {
    const inventory = first[component];
    result[component] = {
      inputPolicySha256,
      componentInputSha256: sha256(canonical({ inputPolicySha256, inputs: inventory.inputs })),
      ...inventory,
      helperEntries: selectBuildEntries(component),
      graphKind:
        component === "web"
          ? "esbuild-helpers-plus-conservative-repository-sources"
          : "fresh-esbuild-transitive-application-inputs",
      limitations:
        component === "web"
          ? WEB_LIMITATIONS
          : [
              "External npm runtime data is covered by locked production dependencies, not an npm package bundle.",
              "Input equivalence is not qualification evidence or deployment authorization.",
            ],
    };
  }
  return {
    schemaVersion: 1,
    kind: "warpdrive-component-inputs",
    inputPolicySha256,
    policy,
    context,
    components: result,
  };
}

export function parseInputArguments(args) {
  const options = { buildArgs: {} };
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index],
      value = args[index + 1];
    if (value === undefined || value.startsWith("--")) fail("Input option requires a value");
    if (key === "--build-arg") {
      const match = /^([A-Z_]+)=(.*)$/u.exec(value);
      if (match === null || Object.hasOwn(options.buildArgs, match[1]))
        fail("Invalid/repeated build argument");
      options.buildArgs[match[1]] = match[2];
    } else {
      const names = {
        "--root": "root",
        "--base-image": "baseImage",
        "--platform": "platform",
        "--component": "components",
      };
      if (!Object.hasOwn(names, key) || Object.hasOwn(options, names[key]))
        fail("Unknown/repeated input option");
      options[names[key]] = key === "--component" ? [value] : value;
    }
  }
  return options;
}

if (
  process.argv[1] &&
  (await realpath(resolve(process.argv[1]))) === (await realpath(fileURLToPath(import.meta.url)))
) {
  try {
    console.log(
      JSON.stringify(await generateComponentInputs(parseInputArguments(process.argv.slice(2)))),
    );
  } catch (error) {
    console.error(
      error instanceof ComponentInputError ? error.message : "Component input discovery failed",
    );
    process.exitCode = 1;
  }
}
