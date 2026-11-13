"""Read-only dependency evidence for the isolated Warpdrive Web SDK.

The caller supplies an authenticated retained input receipt, a clean exact
source checkout, an independently prepared private Web projection, and the
approved registry tarballs. No package code is executed or installed. The
receipt does not qualify Bun/Next bundling or establish image equivalence.
"""

import base64
from hashlib import sha256, sha512
import io
import os
from pathlib import Path
import re
import stat
import tarfile

import component_inputs as inputs
from web_retained_backend_inputs import verify_retained_backend_inputs


PROFILE = "warpdrive-web-ui-sdk-beta1-hoisted-v1"
EXTENSION = "tools/web-ui"
MANIFEST = EXTENSION + "/package.json"
LOCK = EXTENSION + "/bun.lock"
MANAGER = "bun@1.4.4"
ROOT_PACKAGE = "warpdrive-web-ui"
SDK_VERSION = "0.1.0-beta.1"
SDK = {
    "@ui-sdk/core": "sha512-sWsZW8RN6Gviir7REQYuDIafm9hierHQE31OJ+2g+1Pp3lDVKp/dk0+0dxFvqOQRmBveRvlE9FiARgNlQ9dMFw==",
    "@ui-sdk/react": "sha512-7wcUsZI+WoG2uo3N+PHrWntk97qI9ez2cUrHV9H507FiL118Pi4tuhWUCMDtWwEUCNQLybpBm1QRLkEXVOPAUg==",
}
PEERS = {"react": ">=19", "react-dom": ">=19", "@types/react": ">=19.2.10", "@ui-sdk/core": "^0.1.0-beta.1"}
RETAINED = ("worker", "realtime", "migrator")
ROOT_FILES = ("package.json", "bun.lock", "bunfig.toml", "deploy/images/Dockerfile")
WEB_RECIPE = "deploy/images/Web.Dockerfile"
REVIEWED_WEB_INPUTS = {
    WEB_RECIPE: ("d88bc605f5a900c1cdb4c9397060594311fed786", "4f20572a0097ab74c008f4666b4b24e45b856a4ce7f5bbef61aa1e23cbda9eec"),
    MANIFEST: ("e8fa268ffcad83549914dd5fda020ef4f0215911", "09ead474d329be4d9226a42bb61fe9fb970acba4f23fa5fac9b1737d50f13132"),
    LOCK: ("d46e02d61eda1184b96645b971be2501d6d677c0", "b569a2c43b0914012d6a480ef09c6ec699223e5574ebb344a02eac3854374f8a"),
}
SINGLETONS = ("react", "react-dom")
RUNTIMES = (*SINGLETONS, "scheduler", "next")
RESOLUTION_PROBES = (
    "src/warpdrive-extension-probe.mjs",
    "node_modules/next/dist/server/next.js",
    "node_modules/next/dist/client/app-next.js",
    "node_modules/react-dom/index.js",
    "node_modules/@ui-sdk/core/package.json",
    "node_modules/@ui-sdk/react/package.json",
)
REVISION = re.compile(r"[0-9a-f]{40}\Z")
VERSION = re.compile(r"[0-9]+\.[0-9]+\.[0-9]+\Z")
INTEGRITY = re.compile(r"sha512-[a-zA-Z0-9+/]{86}==\Z")
MAX_ARCHIVE = 8 * 1024**2
MAX_PACKAGE = 48 * 1024**2
MAX_FILE = 4 * 1024**2
MAX_MEMBERS = 4_000


class WebExtensionInputError(ValueError):
    """The isolated extension inputs or observed resolution differ."""


def require(condition, reason):
    if not condition:
        raise WebExtensionInputError(reason)


def private_projection(root, web_root):
    for path in (root, web_root):
        require(isinstance(path, Path) and path.is_absolute() and path == path.resolve(strict=True)
                and path.is_dir(), "Canonical source and projection directories required")
    require(not root.is_relative_to(web_root) and not web_root.is_relative_to(root)
            and web_root.stat().st_uid == os.geteuid()
            and stat.S_IMODE(web_root.stat().st_mode) == 0o700, "Separate owned mode-0700 Web projection required")


def file_bytes(path, maximum):
    require(path.is_absolute() and path == path.resolve(strict=True), "Canonical regular input path required")
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), "rb") as stream:
        info = os.fstat(stream.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size <= maximum,
                "Bounded unlinked regular dependency input required")
        raw = stream.read(maximum + 1)
        after = os.fstat(stream.fileno())
        require(len(raw) == info.st_size and info.st_mtime_ns == after.st_mtime_ns
                and info.st_ctime_ns == after.st_ctime_ns and os.path.samestat(info, path.lstat()),
                "Dependency bytes changed while reading")
    return raw


def json_object(raw):
    value = inputs.decode(raw)
    require(type(value) is dict, "Dependency metadata object required")
    return value


def lock_object(raw):
    """Read Bun's JSONC lock with trailing commas and no other extensions."""
    source = raw.decode("utf-8")
    # Preserve string tokens, including escaped quotes and strings ending in a comma.
    cleaned = re.sub(r'"(?:[^"\\]|\\.)*"|,(?=\s*[}\]])',
                     lambda match: "" if match[0] == "," else match[0], source)
    return json_object(cleaned)


def lock_row(packages, name):
    row = packages.get(name)
    require(type(row) is list and len(row) == 4 and isinstance(row[0], str)
            and row[0].startswith(name + "@") and row[1] == "" and type(row[2]) is dict
            and isinstance(row[3], str) and INTEGRITY.fullmatch(row[3]), "Exact npm registry lock row required")
    return row[0][len(name) + 1:], row


def dependency_policy(manifest, app_lock, extension, extension_lock):
    require(manifest.get("packageManager") == MANAGER and type(manifest.get("dependencies")) is dict
            and type(manifest.get("devDependencies")) is dict and type(app_lock.get("packages")) is dict,
            "Exact Bun app manifest and lock required")
    root_dependencies = manifest["dependencies"]
    require(set((*SINGLETONS, "next")) <= root_dependencies.keys()
            and not any(name in manifest[field] for name in SDK for field in ("dependencies", "devDependencies"))
            and not any(key == name or key.endswith("/" + name) for key in app_lock["packages"] for name in SDK),
            "SDK cannot enter the protected root manifest or lock")
    core = {}
    for name in RUNTIMES:
        version, row = lock_row(app_lock["packages"], name)
        require(VERSION.fullmatch(version), "Stable exact shared runtime versions required")
        core[name] = (version, row)
    require(core["react"][0] == core["react-dom"][0] and core["react"][0].startswith("19."),
            "One React 19 and matching React DOM version required")

    expected = {**{name: SDK_VERSION for name in SDK}, **{name: core[name][0] for name in SINGLETONS}}
    require(extension == {"name": ROOT_PACKAGE, "private": True, "type": "module",
                          "packageManager": MANAGER, "dependencies": expected}
            and extension.get("private") is True, "Exact isolated SDK manifest required")
    require(set(extension_lock) == {"lockfileVersion", "configVersion", "workspaces", "packages"}
            and type(extension_lock["lockfileVersion"]) is int and extension_lock["lockfileVersion"] in (2, 3)
            and type(extension_lock["configVersion"]) is int and extension_lock["configVersion"] == 1
            and extension_lock["workspaces"] == {"": {"name": ROOT_PACKAGE, "dependencies": expected}}
            and type(extension_lock["packages"]) is dict, "Exact single-root Bun SDK lock required")
    packages = extension_lock["packages"]
    require(set(packages) == {*SDK, *SINGLETONS, "scheduler"}, "Unreviewed SDK package or nested dependency")
    for name in (*SINGLETONS, "scheduler"):
        require(packages[name] == core[name][1], "SDK lock changes a shared React runtime resolution")
    for name, integrity in SDK.items():
        version, row = lock_row(packages, name)
        metadata = {"peerDependencies": PEERS, "optionalPeers": ["@types/react"]} if name == "@ui-sdk/react" else {}
        require(version == SDK_VERSION and row[2:] == [metadata, integrity], "SDK lock differs from the approved registry package")
    return {name: version for name, (version, _) in core.items()}


def tree_records(directory):
    require(directory.is_dir() and directory == directory.resolve(strict=True), "Canonical installed SDK package directory required")
    result, total = {}, 0
    pending = [directory]
    members = 0
    while pending:
        for path in pending.pop().iterdir():
            members += 1
            require(members <= MAX_MEMBERS, "Installed SDK package exceeds its member budget")
            relative = inputs.safe_path(path.relative_to(directory).as_posix())
            mode = path.lstat().st_mode
            if stat.S_ISDIR(mode):
                require(path.name != "node_modules", "Nested SDK package installs are not admitted")
                pending.append(path)
                continue
            require(stat.S_ISREG(mode), "SDK tree contains a symlink or nonregular member")
            data = file_bytes(path, MAX_FILE)
            total += len(data)
            require(total <= MAX_PACKAGE, "Installed SDK package exceeds its byte budget")
            result[relative] = {"bytes": len(data), "sha256": sha256(data).hexdigest()}
    return result


def npm_archive(path, integrity):
    compressed = file_bytes(path, MAX_ARCHIVE)
    actual = "sha512-" + base64.b64encode(sha512(compressed).digest()).decode("ascii")
    require(actual == integrity, "SDK tarball differs from its approved SHA-512 integrity")
    result, total = {}, 0
    seen = set()
    # The digest is checked before the bounded read-only tar parser sees bytes.
    with tarfile.open(fileobj=io.BytesIO(compressed), mode="r|gz") as archive:
        for member in archive:
            require(len(seen) < MAX_MEMBERS and member.name not in seen, "SDK tarball member inventory exceeds its bound")
            seen.add(member.name)
            require(member.name.startswith("package/") and (member.isdir() or member.isreg()),
                    "SDK tarball has an unsupported path or member type")
            relative = inputs.safe_path(member.name.removeprefix("package/"))
            require("node_modules" not in relative.split("/"), "SDK tarball embeds a dependency tree")
            if member.isdir():
                continue
            total += member.size
            require(0 <= member.size <= MAX_FILE and total <= MAX_PACKAGE, "SDK tarball exceeds its expanded byte budget")
            with archive.extractfile(member) as stream:
                data = stream.read(member.size + 1)
            require(len(data) == member.size, "SDK tarball member is incomplete")
            result[relative] = {"bytes": len(data), "sha256": sha256(data).hexdigest()}
    return result


def verify_sdk_install(web_root, archives):
    require(type(archives) is dict and set(archives) == set(SDK), "Both approved SDK tarballs are required")
    records = {}
    for name, integrity in SDK.items():
        package = web_root / "node_modules" / name
        installed = tree_records(package)
        require(installed == npm_archive(archives[name], integrity), "Installed SDK bytes differ from the approved tarball")
        manifest = json_object(file_bytes(package / "package.json", inputs.MAX_JSON_BYTES))
        require(manifest.get("name") == name and manifest.get("version") == SDK_VERSION
                and manifest.get("type") == "module" and not manifest.get("dependencies")
                and not manifest.get("optionalDependencies")
                and (manifest.get("peerDependencies", {}) == PEERS if name == "@ui-sdk/react"
                     else not manifest.get("peerDependencies")), "Installed SDK dependency shape differs")
        records[name] = {"version": SDK_VERSION, "integrity": integrity,
                         "fileCount": len(installed), "installedTreeSha256": inputs.content_hash(installed)}
    return records


RESOLVE = r"""
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
const [root, app] = process.argv.slice(1);
const modules = path.join(root, "node_modules");
const entry = path.join(root, "src", "warpdrive-extension-probe.mjs");
const packageRoot = (name) => path.join(modules, name);
const pairs = [
  [entry, ["react", "react/jsx-runtime", "react-dom", "react-dom/client", "scheduler", "next",
           "@ui-sdk/core", "@ui-sdk/react/primitive"]],
  [path.join(packageRoot("next"), "dist", "server", "next.js"), ["react", "react/jsx-runtime", "react-dom"]],
  [path.join(packageRoot("next"), "dist", "client", "app-next.js"), ["react", "react/jsx-runtime", "react-dom", "react-dom/client"]],
  [path.join(packageRoot("react-dom"), "index.js"), ["react", "scheduler"]],
  [path.join(packageRoot("@ui-sdk/core"), "package.json"), ["react", "react/jsx-runtime", "react-dom"]],
  [path.join(packageRoot("@ui-sdk/react"), "package.json"), ["react", "react/jsx-runtime", "react-dom",
    "react-dom/client", "@ui-sdk/core"]],
];
function resolve(from, specifier, directory, esm) {
  const filename = esm ? fileURLToPath(import.meta.resolve(specifier, pathToFileURL(from).href)) :
    createRequire(from).resolve(specifier);
  const canonical = fs.realpathSync(filename);
  const relative = path.relative(directory, canonical);
  if (filename !== canonical || !relative || relative.startsWith("..") || path.isAbsolute(relative) ||
      !fs.statSync(canonical).isFile() || relative.split(path.sep).includes("node_modules"))
    throw Error("Unexpected physical resolution");
  return relative.split(path.sep).join("/");
}
const appModules = path.join(app, "node_modules");
const shared = ["react", "react/jsx-runtime", "react-dom", "react-dom/client", "scheduler", "next"];
const sdk = new Set(["@ui-sdk/core", "@ui-sdk/react/primitive"]);
const details = [false, true].map(esm => {
  const selected = new Map();
  const resolutions = pairs.map(([from, specifiers]) => {
    const entries = specifiers.filter(specifier => esm || !sdk.has(specifier));
    const values = Object.fromEntries(entries.map(specifier => {
      const [first, second] = specifier.split("/");
      const name = first.startsWith("@") ? first + "/" + second : first;
      const file = resolve(from, specifier, packageRoot(name), esm);
      if (selected.has(specifier) && selected.get(specifier) !== file) throw Error("Split physical resolution");
      selected.set(specifier, file);
      return [specifier, file];
    }));
    return {from: path.relative(root, from).split(path.sep).join("/"), files: values};
  });
  for (const specifier of shared) {
    const name = specifier.split("/")[0];
    const file = resolve(path.join(app, "package.json"), specifier, path.join(appModules, name), esm);
    if (file !== selected.get(specifier)) throw Error("Shared package entrypoint differs");
  }
  for (const name of sdk) {
    try {
      if (esm) import.meta.resolve(name, pathToFileURL(path.join(app, "package.json")).href);
      else createRequire(path.join(app, "package.json")).resolve(name);
    } catch (error) {
      if (error.code === (esm ? "ERR_MODULE_NOT_FOUND" : "MODULE_NOT_FOUND")) continue;
      throw error;
    }
    throw Error("SDK is visible from the protected app");
  }
  return {condition: esm ? "import" : "require", resolutions};
});
process.stdout.write(JSON.stringify(details));
"""


def verify_resolution(root, web_root, versions):
    for name, version in versions.items():
        original = root / "node_modules" / name / "package.json"
        projected = web_root / "node_modules" / name / "package.json"
        original_raw, projected_raw = (file_bytes(path, MAX_FILE) for path in (original, projected))
        manifest = json_object(original_raw)
        require(original_raw == projected_raw and manifest.get("name") == name and manifest.get("version") == version,
                "Installed projected shared runtime differs from its locked application identity")
    for name in SDK:
        require(not os.path.lexists(root / "node_modules" / name), "SDK is installed in the protected app")
    # Resolve from the exact Next client and server entrypoint neighborhoods, not
    # just from a fabricated top-level import probe.
    for name in RESOLUTION_PROBES[1:]:
        path = web_root / name
        require(path.is_file() and path == path.resolve(strict=True), "A projected resolution anchor is missing or redirected")
    environment = {"PATH": os.environ.get("PATH", os.defpath)}
    details = inputs.decode(inputs._discover(
        ["node", "--no-global-search-paths", "--experimental-import-meta-resolve", "--input-type=module",
         "-e", RESOLVE, str(web_root), str(root)],
        web_root, environment, deadline_seconds=10,
    ))
    require(type(details) is list and [record.get("condition") for record in details] == ["require", "import"]
            and all(tuple(record["from"] for record in detail["resolutions"]) == RESOLUTION_PROBES
                    for detail in details), "Incomplete Node resolution evidence")
    return inputs.content_hash(details)


def verify_web_extension_inputs(root, *, expected_revision, retained_receipt, current_receipt, web_root, sdk_archives):
    """Bind a fixed Web extension to exact source and observed installed files."""
    private_projection(root, web_root)
    require(isinstance(expected_revision, str) and REVISION.fullmatch(expected_revision), "Exact selected revision required")
    retained = inputs.validate_receipt(retained_receipt)
    current = inputs.verify_current(root, current_receipt, expected_revision=expected_revision)
    require(retained["inputPolicySha256"] == current["inputPolicySha256"]
            and all(retained["components"][name] == current["components"][name] for name in RETAINED),
            "A protected backend input, graph or build policy changed")
    return _verify_extension_projection(root, expected_revision, current, web_root, sdk_archives)


def _verify_extension_projection(root, expected_revision, current, web_root, sdk_archives, *, candidate_baseline=None):
    from web_release_inputs import _git, _tree, _verify_baseline_blobs

    tree = _tree(root, expected_revision)
    require({path for path in tree if path.startswith(EXTENSION + "/")} == {MANIFEST, LOCK},
            "The Web SDK source island must contain exactly its manifest and lock")
    require(not _git(root, "ls-files", "--others", "--", EXTENSION, allow_empty=True),
            "The source island contains an untracked input")
    paths = (*ROOT_FILES, MANIFEST, LOCK)
    if candidate_baseline is not None:
        paths = (*paths, WEB_RECIPE)
    records = {}
    raw = {}
    for name in paths:
        require(tree.get(name, (None,))[0] == "100644", "Dependency and recipe inputs must be tracked regular files")
        raw[name] = file_bytes(root / name, inputs.MAX_JSON_BYTES)
        records[name] = {"path": name, "bytes": len(raw[name]), "sha256": sha256(raw[name]).hexdigest()}
    for component in RETAINED:
        indexed = {item["path"]: item for item in current["components"][component]["inputs"]}
        require(all(indexed.get(name) == records[name] for name in ROOT_FILES)
                and not any(path.startswith(EXTENSION + "/") for path in indexed)
                and (candidate_baseline is None or WEB_RECIPE not in indexed),
                "A retained component reads the Web extension or lacks protected root build inputs")
    verified_paths = (MANIFEST, LOCK)
    projection_paths = ("package.json",)
    if candidate_baseline is not None:
        baseline_tree = _tree(root, candidate_baseline)
        require(all(baseline_tree.get(name) == tree[name] for name in ROOT_FILES),
                "Protected root dependency or backend recipe differs from the selected Web baseline")
        for name, (blob, digest) in REVIEWED_WEB_INPUTS.items():
            require(tree[name] == ("100644", "blob", blob) and records[name]["sha256"] == digest,
                    "Current Web recipe or SDK sidecar differs from the reviewed source")
            require(name not in baseline_tree or baseline_tree[name] == tree[name],
                    "Selected Web baseline uses a different SDK recipe or sidecar")
        verified_paths = (*ROOT_FILES, MANIFEST, LOCK, WEB_RECIPE)
        projection_paths = ("package.json", "bun.lock", "bunfig.toml")
    _verify_baseline_blobs(root, tree, {"components": {"web-extension": {"inputs": [records[name] for name in verified_paths]}}})
    versions = dependency_policy(json_object(raw["package.json"]), lock_object(raw["bun.lock"]),
                                 json_object(raw[MANIFEST]), lock_object(raw[LOCK]))

    def projection_matches():
        return all(file_bytes(web_root / name, inputs.MAX_JSON_BYTES) == raw[name] for name in projection_paths)

    projection_error = ("Projected app manifest differs from protected source" if candidate_baseline is None
                        else "Projected app manifest or locked configuration differs from protected source")
    require(projection_matches(), projection_error)
    sdk = verify_sdk_install(web_root, sdk_archives)
    resolution = verify_resolution(root, web_root, versions)
    require(verify_sdk_install(web_root, sdk_archives) == sdk
            and verify_resolution(root, web_root, versions) == resolution and projection_matches()
            and all(file_bytes(root / name, inputs.MAX_JSON_BYTES) == data for name, data in raw.items()),
            "Dependency evidence changed during verification")
    result = {"schemaVersion": 1, "kind": "warpdrive-web-extension-inputs", "profile": PROFILE,
              "sourceRevision": expected_revision, "packageManager": MANAGER,
              "protectedRootInputs": [records[name] for name in ROOT_FILES],
              "extensionInputs": [records[name] for name in (MANIFEST, LOCK)],
              "retainedComponentInputSha256": {name: current["components"][name]["componentInputSha256"] for name in RETAINED},
              "sdk": sdk, "observedSharedRuntimeVersions": versions, "nodeResolutionSha256": resolution,
              "buildIntegrationQualified": False, "deploymentAuthorized": False}
    if candidate_baseline is not None:
        result.update(kind="warpdrive-web-extension-candidate-inputs", baselineRevision=candidate_baseline,
                      webRecipe={**records[WEB_RECIPE], "gitBlob": tree[WEB_RECIPE][2]},
                      extensionInputs=[{**records[name], "gitBlob": tree[name][2]} for name in (MANIFEST, LOCK)])
    return result


def verify_web_extension_candidate(root, *, expected_revision, expected_baseline_revision, retained_receipt,
                                   expected_retained_sha256, web_root, sdk_archives):
    """Verify exact SDK candidate dependencies and independently retained backend inputs.

    The caller authenticates the selected active Web baseline revision and the
    full original backend input receipt. Effective Docker context, functional
    source policy, native final-image and browser qualification are separate.
    """
    from web_release_inputs import _git

    private_projection(root, web_root)
    require(all(isinstance(revision, str) and REVISION.fullmatch(revision)
                for revision in (expected_revision, expected_baseline_revision)) and expected_baseline_revision != expected_revision,
            "Distinct exact active Web baseline and SDK candidate revisions required")
    _git(root, "merge-base", "--is-ancestor", expected_baseline_revision, expected_revision, allow_empty=True)
    current = verify_retained_backend_inputs(root, expected_revision=expected_revision, retained_receipt=retained_receipt,
                                              expected_retained_sha256=expected_retained_sha256)
    result = _verify_extension_projection(root, expected_revision, current, web_root, sdk_archives,
                                          candidate_baseline=expected_baseline_revision)
    inputs.verify_source_revision(root, current, expected_revision)
    return {**result, "retainedBackendInputsSha256": inputs.content_hash(current),
            "originalBackendReceiptSha256": expected_retained_sha256}
