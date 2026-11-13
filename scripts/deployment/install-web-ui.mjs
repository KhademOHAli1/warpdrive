/**
 * Install the two reviewed Web SDK packages into an already installed app.
 * Run after the app's frozen install and before starting any consumers.
 */
import { dlopen, FFIType } from "bun:ffi";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const BUN_VERSION = "1.4.4";
const SIDECAR = new Map([
  ["package.json", "09ead474d329be4d9226a42bb61fe9fb970acba4f23fa5fac9b1737d50f13132"],
  ["bun.lock", "b569a2c43b0914012d6a480ef09c6ec699223e5574ebb344a02eac3854374f8a"],
]);
const SDK = new Map([
  ["core", "dist/index.js"],
  ["react", "dist/primitive.js"],
]);
const SHARED = ["react", "react-dom", "scheduler"];
const METADATA_BYTES = 4 * 1024 ** 2;
const MAX_PACKAGE_BYTES = 48 * 1024 ** 2;
const MAX_FILE_BYTES = 4 * 1024 ** 2;
const MAX_MEMBERS = 4000;
const MAX_DEPTH = 16;
const FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

function require(condition, message) {
  if (!condition) throw new Error(message);
}

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function directory(path) {
  const info = lstatSync(path, { bigint: true });
  require(info.isDirectory() &&
    info.uid === BigInt(process.geteuid()) &&
    (info.mode & 0o022n) === 0n &&
    realpathSync(path) ===
      path, "An owned, canonical directory without group/world write permission is required");
  return info;
}

function readRegular(path, maximum, { unlinked = false } = {}) {
  const descriptor = openSync(path, FLAGS);
  try {
    const before = fstatSync(descriptor, { bigint: true });
    require(before.isFile() &&
      before.size <= BigInt(maximum) &&
      before.uid === BigInt(process.geteuid()) &&
      (before.mode & 0o022n) === 0n &&
      (!unlinked || before.nlink === 1n), "Unsafe or oversized dependency input");
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let length = 0;
    while (length < bytes.length) {
      const received = readSync(descriptor, bytes, length, bytes.length - length, null);
      if (!received) break;
      length += received;
    }
    const after = fstatSync(descriptor, { bigint: true });
    require(length === Number(before.size) &&
      before.size === after.size &&
      before.mtimeNs === after.mtimeNs &&
      before.ctimeNs === after.ctimeNs &&
      sameFile(
        before,
        lstatSync(path, { bigint: true }),
      ), "Dependency input changed while reading");
    return { bytes: bytes.subarray(0, length), executable: (before.mode & 0o111n) !== 0n };
  } finally {
    closeSync(descriptor);
  }
}

function metadata(path, options) {
  return readRegular(path, METADATA_BYTES, options).bytes;
}

function verifyTarget(root, target) {
  directory(root);
  if (target === root) return;
  const targetInfo = directory(target);
  require((targetInfo.mode & 0o777n) ===
    0o700n, "A separate app projection must be private (mode 0700)");
  for (const name of ["package.json", "bun.lock", "bunfig.toml"]) {
    require(metadata(join(root, name)).equals(
      metadata(join(target, name)),
    ), "The target application lock and manifest must match the source checkout");
  }
}

function exactSidecar(root, scratch) {
  const sidecar = join(root, "tools/web-ui");
  directory(sidecar);
  for (const [name, digest] of SIDECAR) {
    const bytes = metadata(join(sidecar, name), { unlinked: true });
    require(hash(bytes) === digest, "The reviewed Web UI lock and manifest are required");
    writeFileSync(join(scratch, name), bytes, { flag: "wx", mode: 0o600 });
  }
}

function installSidecar(scratch) {
  const config = join(scratch, "bunfig.toml");
  writeFileSync(config, "", { flag: "wx", mode: 0o600 });
  const result = spawnSync(
    process.execPath,
    [
      "--no-env-file",
      "install",
      "--frozen-lockfile",
      "--ignore-scripts",
      "--linker=hoisted",
      "--backend=copyfile",
      "--registry=https://registry.npmjs.org",
      `--config=${config}`,
      `--cache-dir=${join(scratch, "cache")}`,
    ],
    {
      cwd: scratch,
      env: {
        PATH: process.env.PATH,
        LC_ALL: "C",
        XDG_CONFIG_HOME: scratch,
        XDG_CACHE_HOME: scratch,
        TMPDIR: scratch,
      },
      timeout: 120_000,
      killSignal: "SIGKILL",
      maxBuffer: 128 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  require(!result.error && result.status === 0, "Frozen Web SDK sidecar installation failed");
}

function packageTree(path, { unlinked = false } = {}) {
  const rows = [];
  let total = 0;
  function visit(folder, prefix, depth) {
    require(depth <= MAX_DEPTH, "Dependency tree exceeds its depth budget");
    const before = directory(folder);
    for (const leaf of readdirSync(folder).sort()) {
      require(/^[a-zA-Z0-9._@+-]+$/u.test(leaf) &&
        leaf !== "node_modules" &&
        rows.length < MAX_MEMBERS, "Unsafe or excessive dependency tree membership");
      const relative = prefix + leaf;
      const child = join(folder, leaf);
      const kind = lstatSync(child);
      if (kind.isDirectory()) {
        rows.push([relative, "directory"]);
        visit(child, `${relative}/`, depth + 1);
      } else {
        const { bytes, executable } = readRegular(
          child,
          Math.min(MAX_FILE_BYTES, MAX_PACKAGE_BYTES - total),
          { unlinked },
        );
        total += bytes.length;
        rows.push([relative, "file", bytes.length, hash(bytes), executable]);
      }
    }
    const after = directory(folder);
    require(sameFile(before, after) &&
      before.mtimeNs === after.mtimeNs &&
      before.ctimeNs === after.ctimeNs, "Dependency directory changed while reading");
  }
  visit(path, "", 0);
  return hash(JSON.stringify(rows));
}

function scopeTree(scope) {
  directory(scope);
  const leaves = readdirSync(scope).sort();
  require(leaves.length === SDK.size &&
    leaves.every((name) =>
      SDK.has(name),
    ), "The existing SDK scope has foreign or missing packages");
  return [...SDK].map(([name, entrypoint]) => {
    const path = join(scope, name);
    const info = packageTree(path, { unlinked: true });
    require(lstatSync(join(path, entrypoint)).isFile(), "The reviewed SDK entrypoint is missing");
    return info;
  });
}

function sameScope(expected, actual) {
  return expected.every((digest, index) => digest === actual[index]);
}

function compareShared(sidecar, modules) {
  const current = SHARED.map((name) => packageTree(join(modules, name)));
  require(SHARED.every(
    (name, index) => packageTree(join(sidecar, name), { unlinked: true }) === current[index],
  ), "The app must supply the exact physical React, React DOM and scheduler installations");
  return current;
}

function exclusiveRename(from, to) {
  const linux = process.platform === "linux";
  require(linux || process.platform === "darwin", "Atomic SDK publication requires Linux or macOS");
  const symbol = linux ? "renameat2" : "renameatx_np";
  const { i32, cstring, u32 } = FFIType;
  const library = dlopen(linux ? "libc.so.6" : "/usr/lib/libSystem.B.dylib", {
    [symbol]: { args: [i32, cstring, i32, cstring, u32], returns: i32 },
  });
  try {
    // Linux RENAME_NOREPLACE or macOS RENAME_EXCL | RENAME_NOFOLLOW_ANY.
    return library.symbols[symbol](from, "@ui-sdk", to, "@ui-sdk", linux ? 1 : 0x14) === 0;
  } finally {
    library.close();
  }
}

function pinDirectory(path, expected) {
  const descriptor = openSync(path, FLAGS | constants.O_DIRECTORY);
  if (sameFile(expected, fstatSync(descriptor, { bigint: true }))) return descriptor;
  closeSync(descriptor);
  throw new Error("Target directory changed before SDK publication");
}

function existingScope(destination, expected) {
  try {
    lstatSync(destination);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  require(sameScope(
    expected,
    scopeTree(destination),
  ), "Existing SDK packages differ from the reviewed install");
  return true;
}

function assertIdentity(path, expected) {
  require(sameFile(directory(path), expected), "SDK installation directory changed");
}

function finishProjection(sidecar, modules, sourceIdentity, modulesIdentity) {
  const from = pinDirectory(sidecar, sourceIdentity);
  try {
    const to = pinDirectory(modules, modulesIdentity);
    try {
      return exclusiveRename(from, to);
    } finally {
      closeSync(to);
    }
  } finally {
    closeSync(from);
  }
}

/** Publish a complete scope in a single atomic, no-overwrite directory operation. */
export function projectWebUiScope(sidecar, modules, modulesIdentity = directory(modules)) {
  const sourceIdentity = directory(sidecar);
  const destination = join(modules, "@ui-sdk");
  const expected = scopeTree(join(sidecar, "@ui-sdk"));
  const shared = compareShared(sidecar, modules);
  assertIdentity(modules, modulesIdentity);
  const exists = existingScope(destination, expected);
  const published = !exists && finishProjection(sidecar, modules, sourceIdentity, modulesIdentity);
  assertIdentity(modules, modulesIdentity);
  require(existingScope(
    destination,
    expected,
  ), "Could not atomically publish the complete SDK scope");
  require(SHARED.every(
    (name, index) => packageTree(join(modules, name)) === shared[index],
  ), "Shared React runtime changed during SDK installation");
  return published ? "installed" : "unchanged";
}

export function installWebUi(target = ROOT) {
  require(process.versions.bun === BUN_VERSION, "The project-pinned Bun 1.4.4 is required");
  require(isAbsolute(target), "An absolute owned target app directory is required");
  verifyTarget(ROOT, target);
  const modules = join(target, "node_modules");
  const modulesIdentity = directory(modules);
  const scratch = mkdtempSync(join(modules, ".warpdrive-web-ui-"));
  const scratchIdentity = directory(scratch);
  try {
    exactSidecar(ROOT, scratch);
    installSidecar(scratch);
    for (const [name, digest] of SIDECAR) {
      require(hash(metadata(join(scratch, name))) ===
        digest, "Frozen sidecar metadata changed during install");
    }
    verifyTarget(ROOT, target);
    return projectWebUiScope(join(scratch, "node_modules"), modules, modulesIdentity);
  } finally {
    assertIdentity(scratch, scratchIdentity);
    rmSync(scratch, { recursive: true });
  }
}

function parseArgs(args) {
  if (args.length === 0) return ROOT;
  require(args.length === 2 &&
    args[0] === "--target" &&
    isAbsolute(
      args[1],
    ), "Usage: bun --no-env-file scripts/deployment/install-web-ui.mjs [--target /absolute/app-root]");
  return args[1];
}

if (import.meta.main) {
  try {
    const status = installWebUi(parseArgs(process.argv.slice(2)));
    process.stdout.write(`Web UI SDK projection: ${status}\n`);
  } catch (error) {
    process.stderr.write(
      `Web UI SDK projection held: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    process.exitCode = 1;
  }
}
