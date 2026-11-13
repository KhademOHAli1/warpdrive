import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildOptionsForEntry,
  discoverBuildGraphs,
  parseBuildArguments,
  selectBuildEntries,
} from "../build-workers.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const relativeName = (path) => relative(root, path).split(sep).join("/");

test("default builder preserves every existing entrypoint", () => {
  assert.deepEqual(
    selectBuildEntries().map((entry) => entry.out),
    [
      "dist/next.config.mjs",
      "dist/workflow-code-worker.mjs",
      "dist/ws.mjs",
      "dist/worker.mjs",
      "dist/migrate.mjs",
      "dist/sweep-spam.mjs",
      "dist/auth-operator.mjs",
    ],
  );
});

test("non-web selections exclude Next configuration and retain required child workers", () => {
  assert.deepEqual(selectBuildEntries("realtime"), [
    { in: "src/entrypoints/ws.ts", out: "dist/ws.mjs" },
  ]);
  for (const component of ["worker", "realtime", "migrator"])
    assert.ok(!selectBuildEntries(component).some((entry) => entry.in === "next.config.ts"));
  for (const component of ["worker", "web"])
    assert.ok(
      selectBuildEntries(component).some((entry) => entry.out === "dist/workflow-code-worker.mjs"),
    );
  assert.ok(selectBuildEntries("migrator").some((entry) => entry.out === "dist/auth-operator.mjs"));
});

test("invalid or ambiguous selection fails before importing esbuild or writing outputs", () => {
  for (const args of [
    ["--component"],
    ["--component", "--list"],
    ["--component", "unknown"],
    ["--component", "worker", "--component", "web"],
    ["--list", "--list"],
    ["--unknown"],
  ])
    assert.throws(() => parseBuildArguments(args));
});

test("list command runs without build dependencies or a source checkout", () => {
  const isolated = mkdtempSync(join(tmpdir(), "warpdrive-build-selection-"));
  try {
    const result = spawnSync(
      process.execPath,
      [join(root, "scripts/build-workers.mjs"), "--component", "realtime", "--list"],
      { cwd: isolated, encoding: "utf8", timeout: 5_000 },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), selectBuildEntries("realtime"));
    assert.deepEqual(readdirSync(isolated), []);
  } finally {
    rmSync(isolated, { recursive: true, force: true });
  }
});

test("the CLI entrypoint still runs when invoked through a symlinked scripts directory", () => {
  const isolated = mkdtempSync(join(tmpdir(), "warpdrive-build-symlink-"));
  try {
    symlinkSync(join(root, "scripts"), join(isolated, "scripts"), "dir");
    const result = spawnSync(
      process.execPath,
      ["scripts/build-workers.mjs", "--component", "migrator", "--list"],
      { cwd: isolated, encoding: "utf8", timeout: 5_000 },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), selectBuildEntries("migrator"));
    assert.deepEqual(readdirSync(isolated), ["scripts"]);
  } finally {
    rmSync(isolated, { recursive: true, force: true });
  }
});

test("discovery shares production entry/options and explicitly never writes bundles", async () => {
  const calls = [];
  const graphs = await discoverBuildGraphs("worker", {
    root,
    build: (options) => {
      calls.push(options);
      return Promise.resolve({
        warnings: [],
        metafile: { inputs: { [options.entryPoints[0]]: { bytes: 1, imports: [] } } },
      });
    },
  });
  assert.deepEqual(
    graphs.map((graph) => graph.entry),
    selectBuildEntries("worker"),
  );
  for (const [index, entry] of selectBuildEntries("worker").entries()) {
    assert.deepEqual(calls[index], {
      ...buildOptionsForEntry(entry, root),
      metafile: true,
      write: false,
      logLevel: "silent",
    });
    assert.equal(calls[index].packages, "external");
    assert.equal(calls[index].preserveSymlinks, true);
  }
});

test("warnings and missing metafiles cannot be treated as complete fresh input graphs", async () => {
  for (const result of [
    { warnings: [{}], metafile: { inputs: { a: {} } } },
    { warnings: [] },
    { warnings: [], metafile: { inputs: {} } },
  ]) {
    await assert.rejects(
      discoverBuildGraphs("realtime", { root, build: () => Promise.resolve(result) }),
    );
  }
});

test("non-web Docker targets cannot reach the Next build stage", () => {
  const dockerfile = readFileSync(join(root, "deploy/images/Dockerfile"), "utf8");
  const stages = new Map();
  let current;
  for (const line of dockerfile.split("\n")) {
    const from = /^FROM\s+(\S+)\s+AS\s+(\S+)$/i.exec(line);
    if (from) {
      current = { base: from[1], lines: [] };
      stages.set(from[2], current);
    } else if (current) current.lines.push(line);
  }
  function dependencies(name, visited = new Set()) {
    if (visited.has(name) || !stages.has(name)) return visited;
    visited.add(name);
    const stage = stages.get(name);
    dependencies(stage.base, visited);
    for (const line of stage.lines) {
      const copy = /^COPY\s/.test(line) ? /\s--from=(\S+)/.exec(line) : null;
      if (copy) dependencies(copy[1], visited);
    }
    return visited;
  }
  for (const component of ["worker", "realtime", "migrator"]) {
    const required = dependencies(component);
    assert.ok(required.has(`${component}-build`));
    assert.ok(required.has("runtime-base"));
    assert.ok(required.has("prod-deps"));
    assert.ok(required.has("deps"));
    assert.ok(!required.has("web-build"));
    assert.ok(
      [...required].every(
        (name) => !stages.get(name).lines.some((line) => /next build|\/\.next/.test(line)),
      ),
    );
  }
  assert.ok(dependencies("web").has("web-build"));
});

function omittedContextImports(ts, options, files, omitted) {
  const context = {
    ...ts.sys,
    fileExists: (path) => !omitted.has(relativeName(path)) && ts.sys.fileExists(path),
  };
  const cache = ts.createModuleResolutionCache(root, (name) => name, options);
  const contextCache = ts.createModuleResolutionCache(root, (name) => name, options);
  const mismatches = [];
  for (const path of files) {
    const references = ts.preProcessFile(readFileSync(path, "utf8"), true, true);
    for (const { fileName: specifier } of references.importedFiles) {
      if (!specifier.startsWith(".") && !specifier.startsWith("@/")) continue;
      const original = ts.resolveModuleName(specifier, path, options, ts.sys, cache).resolvedModule;
      if (!original || !omitted.has(relativeName(original.resolvedFileName))) continue;
      const inContext = ts.resolveModuleName(
        specifier,
        path,
        options,
        context,
        contextCache,
      ).resolvedModule;
      const outcome = inContext
        ? `resolves instead to ${relativeName(inContext.resolvedFileName)}`
        : "missing in Docker";
      mismatches.push(
        `${relativeName(path)} imports ${specifier} -> ${relativeName(original.resolvedFileName)} (excluded; ${outcome})`,
      );
    }
  }
  return mismatches;
}

test("Docker context keeps local TypeScript imports", {
  skip: process.env.RUN_IMAGE_CONTEXT_IMPORT_CHECK !== "1",
}, async () => {
  const { default: ts } = await import("typescript");
  // Use the Docker-ignore matcher already installed by our locked Testcontainers.
  const requireFromTestcontainers = createRequire(import.meta.resolve("testcontainers"));
  const dockerIgnore = requireFromTestcontainers("@balena/dockerignore");
  const listing = spawnSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    timeout: 5_000,
  });
  assert.equal(listing.status, 0, listing.stderr);
  const tracked = new Set(listing.stdout.split("\0").filter(Boolean));
  const dockerfileIgnore = join(root, "deploy/images/Dockerfile.dockerignore");
  const ignoreFile = ts.sys.fileExists(dockerfileIgnore)
    ? dockerfileIgnore
    : join(root, ".dockerignore");
  const ignore = dockerIgnore().add(readFileSync(ignoreFile, "utf8"));
  const omitted = new Set([...tracked].filter((name) => ignore.ignores(name)));
  const inContext = (path) => {
    const name = relativeName(path);
    return tracked.has(name) && !omitted.has(name);
  };

  const configPath = join(root, "tsconfig.json");
  const config = ts.readConfigFile(configPath, (path) => ts.sys.readFile(path));
  assert.equal(config.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    {
      ...ts.sys,
      readDirectory: (...args) => ts.sys.readDirectory(...args).filter(inContext),
    },
    root,
    undefined,
    configPath,
  );
  assert.deepEqual(parsed.errors, []);
  const files = parsed.fileNames.filter(inContext);
  assert.ok(files.length > 0, "Docker context has no TypeScript sources");
  const mismatches = omittedContextImports(ts, parsed.options, files, omitted);
  assert.ok(
    mismatches.length === 0,
    `Docker source context changes ${mismatches.length} local TypeScript imports:\n${mismatches.slice(0, 20).join("\n")}`,
  );
});
