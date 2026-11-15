"""Propose source-module SemVer changes without publishing or deploying anything.

Version-decision fingerprints are deliberately separate from immutable image input
receipts. This inventory does not establish compatibility or installed versions.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
from hashlib import sha1, sha256
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys

REGISTRY = "docs/delivery/module-versions.json"
KIND = "warpdrive-module-version-registry"
SEMVER = re.compile(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\Z")
SHA = re.compile(r"[a-f0-9]{40}\Z")
DIGEST = re.compile(r"sha256:[a-f0-9]{64}\Z")
MODULE_ID = re.compile(r"[a-z][a-z0-9]*(?:-[a-z0-9]+)*\Z")
MAX_JSON = 4 * 1024**2
MAX_FILES = 20000
MAX_SOURCE_BYTES = 256 * 1024**2
MAX_FILE_BYTES = 32 * 1024**2
MAX_PATH_BYTES = 4096
MODULE_KINDS = {"application", "service", "migration", "integration", "operator-toolkit", "static-site", "public-content"}
MEANING = "source-module-semver"


class VersionError(ValueError):
    pass


def require(value, message):
    if not value:
        raise VersionError(message)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()


def digest(value):
    return sha256(canonical(value)).hexdigest()


def pairs(items):
    value = {}
    for key, item in items:
        require(key not in value, "Duplicate JSON field")
        value[key] = item
    return value


def decode(raw):
    require(isinstance(raw, bytes) and 0 < len(raw) <= MAX_JSON, "Bounded JSON required")
    try:
        return json.loads(raw, object_pairs_hook=pairs,
                          parse_constant=lambda _: (_ for _ in ()).throw(VersionError("Non-finite JSON")))
    except (UnicodeError, json.JSONDecodeError, RecursionError) as error:
        raise VersionError("Invalid JSON") from error


def exact(value, keys, message):
    require(type(value) is dict and set(value) == set(keys), message)


def safe_path(value, *, prefix=True):
    require(type(value) is str and 0 < len(value) and "\\" not in value
            and not any(ord(char) < 32 or ord(char) == 127 for char in value), "Safe repository path required")
    # A full repository-relative path can span many ordinary directory names.
    # Keep a finite byte bound without confusing it with a single-name limit.
    require(len(value.encode("utf-8")) <= MAX_PATH_BYTES, "Repository path exceeds byte limit")
    normalized = value[:-1] if prefix and value.endswith("/") else value
    path = PurePosixPath(normalized)
    require(normalized and not path.is_absolute() and str(path) == normalized
            and all(part not in {".", "..", ".git"} for part in path.parts)
            and ":" not in normalized and "*" not in normalized and "?" not in normalized,
            "Unsafe repository path")
    return value


def path_list(value):
    require(type(value) is list and 0 < len(value) <= 128 and all(type(path) is str for path in value)
            and len(set(value)) == len(value), "Unique path scopes required")
    for path in value:
        safe_path(path)
    return value


def matches(path, scope):
    return path.startswith(scope) if scope.endswith("/") else path == scope


def version_tuple(version):
    require(type(version) is str and SEMVER.fullmatch(version), "Stable non-prefixed SemVer required")
    values = tuple(map(int, version.split(".")))
    require(max(values) <= 1000000000, "Bounded SemVer required")
    return values


def bump_version(version, bump):
    major, minor, patch = version_tuple(version)
    require(bump in {"patch", "minor", "major"}, "Explicit SemVer bump required")
    result = {"patch": f"{major}.{minor}.{patch + 1}", "minor": f"{major}.{minor + 1}.0", "major": f"{major + 1}.0.0"}[bump]
    version_tuple(result)
    return result


def validate_registry(value):
    exact(value, {"schemaVersion", "kind", "versionMeaning", "baselineSourceRevision", "modules", "sharedPaths",
                  "ignoredPaths", "ignoreVersionOnlyChanges"}, "Closed module registry required")
    require(type(value["schemaVersion"]) is int and value["schemaVersion"] == 1 and value["kind"] == KIND
            and value["versionMeaning"] == MEANING and type(value["baselineSourceRevision"]) is str
            and SHA.fullmatch(value["baselineSourceRevision"]), "Unsupported source module registry")
    modules = value["modules"]
    require(type(modules) is dict and 1 <= len(modules) <= 64, "Bounded module catalog required")
    for identifier, module in modules.items():
        require(type(identifier) is str and MODULE_ID.fullmatch(identifier), "Safe module ID required")
        exact(module, {"name", "kind", "version", "paths", "dependencies"}, "Closed source module record required")
        require(type(module["name"]) is str and 0 < len(module["name"]) <= 120
                and not any(ord(char) < 32 for char in module["name"])
                and type(module["kind"]) is str and module["kind"] in MODULE_KINDS, "Source module name/kind required")
        version_tuple(module["version"])
        path_list(module["paths"])
        dependencies = module["dependencies"]
        require(type(dependencies) is list and all(type(dep) is str for dep in dependencies)
                and len(dependencies) == len(set(dependencies))
                and all(type(dep) is str and dep in modules and dep != identifier for dep in dependencies),
                "Known unique module dependencies required")
    visited, active = set(), set()

    def visit(identifier):
        require(identifier not in active, "Module dependency cycle")
        if identifier in visited:
            return
        active.add(identifier)
        for dependency in modules[identifier]["dependencies"]:
            visit(dependency)
        active.remove(identifier)
        visited.add(identifier)

    for identifier in modules:
        visit(identifier)
    require(type(value["sharedPaths"]) is list and len(value["sharedPaths"]) <= 64, "Bounded shared path declarations required")
    for shared in value["sharedPaths"]:
        exact(shared, {"paths", "modules"}, "Closed shared path declaration required")
        path_list(shared["paths"])
        require(type(shared["modules"]) is list and shared["modules"] and all(type(item) is str for item in shared["modules"])
                and len(set(shared["modules"])) == len(shared["modules"])
                and all(type(item) is str and item in modules for item in shared["modules"]), "Known shared consumers required")
    for key in ("ignoredPaths", "ignoreVersionOnlyChanges"):
        path_list(value[key])
    require(REGISTRY in value["ignoredPaths"], "Generated registry must not trigger a version loop")
    require(all(path.endswith("package.json") and not path.endswith("/") for path in value["ignoreVersionOnlyChanges"]),
            "Only package manifest version fields may be normalized")
    return value


def validate_changes(value, modules):
    if value is None:
        return {}
    exact(value, {"schemaVersion", "bumps"}, "Closed reviewed bump intent required")
    require(type(value["schemaVersion"]) is int and value["schemaVersion"] == 1 and type(value["bumps"]) is dict,
            "Versioned bump intent required")
    require(all(identifier in modules and type(bump) is str and bump in {"patch", "minor", "major"}
                for identifier, bump in value["bumps"].items()), "Unknown module or unsupported bump intent")
    return value["bumps"]


class Git:
    def __init__(self, repo):
        self.repo = Path(repo).resolve(strict=True)
        self.cache = {}
        self.environment = {"PATH": os.defpath, "LC_ALL": "C", "GIT_CONFIG_NOSYSTEM": "1",
                            "GIT_CONFIG_GLOBAL": os.devnull, "GIT_NO_REPLACE_OBJECTS": "1",
                            "GIT_NO_LAZY_FETCH": "1", "GIT_TERMINAL_PROMPT": "0"}

    def run(self, *arguments, data=None, maximum=MAX_SOURCE_BYTES + 8 * 1024**2):
        result = subprocess.run(["git", "--no-optional-locks", "--no-replace-objects", "-c", "core.hooksPath=/dev/null",
                                 "-c", "core.fsmonitor=false", "-C", str(self.repo), *arguments],
                                input=data, capture_output=True, timeout=30, env=self.environment)
        require(result.returncode == 0 and len(result.stdout) <= maximum, "Bounded local Git read failed")
        return result.stdout

    def revision(self, revision):
        require(type(revision) is str and (SHA.fullmatch(revision) or revision == "HEAD"), "Full commit SHA or HEAD required")
        result = self.run("rev-parse", "--verify", revision + "^{commit}", maximum=128).strip().decode("ascii")
        require(SHA.fullmatch(result), "Exact source commit required")
        return result

    def tree(self, revision):
        if revision not in self.cache:
            records = {}
            for row in self.run("ls-tree", "-rlz", "--full-tree", revision).split(b"\0"):
                if not row:
                    continue
                header, name = row.split(b"\t", 1)
                mode, kind, oid, size = header.split()
                path = name.decode("utf-8")
                safe_path(path, prefix=False)
                require(kind == b"blob" and size.isdigit(), "Regular Git blob tree required")
                records[path] = {"mode": mode.decode(), "kind": kind.decode(), "oid": oid.decode(), "bytes": int(size)}
            require(len(records) <= MAX_FILES, "Source tree exceeds inventory limit")
            self.cache[revision] = records
        return self.cache[revision]

    def blobs(self, revision, paths):
        tree = self.tree(revision)
        paths = sorted(set(paths))
        require(all(path in tree and tree[path]["mode"] in {"100644", "100755"} and tree[path]["kind"] == "blob"
                    and 0 <= tree[path]["bytes"] <= MAX_FILE_BYTES for path in paths), "Bounded regular committed source required")
        require(sum(tree[path]["bytes"] for path in paths) <= MAX_SOURCE_BYTES, "Version source inventory exceeds byte limit")
        if not paths:
            return {}
        objects = sorted({tree[path]["oid"] for path in paths})
        raw = self.run("cat-file", "--batch", data="".join(oid + "\n" for oid in objects).encode())
        position, contents = 0, {}
        for expected in objects:
            end = raw.find(b"\n", position)
            require(end >= position, "Truncated Git batch header")
            oid, kind, size = raw[position:end].decode("ascii").split()
            size = int(size)
            require(oid == expected and kind == "blob" and 0 <= size <= MAX_FILE_BYTES, "Git blob header differs")
            body = raw[end + 1:end + 1 + size]
            require(len(body) == size and raw[end + 1 + size:end + 2 + size] == b"\n"
                    and sha1(f"blob {size}\0".encode() + body, usedforsecurity=False).hexdigest() == oid, "Git blob contents differ")
            contents[oid] = body
            position = end + size + 2
        require(position == len(raw), "Unexpected Git batch trailer")
        return {path: contents[tree[path]["oid"]] for path in paths}

    def registry(self, revision, *, optional=False):
        if REGISTRY not in self.tree(revision):
            require(optional, "Committed module registry is missing")
            return None
        return validate_registry(decode(self.blobs(revision, [REGISTRY])[REGISTRY]))

    def changed(self, base, head):
        raw = self.run("diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--name-only", "-z", base, head, "--")
        paths = [path.decode("utf-8") for path in raw.split(b"\0") if path]
        require(len(paths) <= MAX_FILES, "Changed source inventory exceeds limit")
        for path in paths:
            safe_path(path, prefix=False)
        return sorted(set(paths))


def normalized_blob(path, raw, registry):
    if path in registry["ignoreVersionOnlyChanges"]:
        value = decode(raw)
        require(type(value) is dict, "Package manifest object required")
        value.pop("version", None)
        return canonical(value)
    return raw


def affected_modules(registry, changed):
    affected = {identifier: {"paths": set(), "reasons": set()} for identifier in registry["modules"]}
    for path in changed:
        for identifier, module in registry["modules"].items():
            if any(matches(path, scope) for scope in module["paths"]):
                affected[identifier]["paths"].add(path)
                affected[identifier]["reasons"].add("source-path")
        for shared in registry["sharedPaths"]:
            if any(matches(path, scope) for scope in shared["paths"]):
                for identifier in shared["modules"]:
                    affected[identifier]["paths"].add(path)
                    affected[identifier]["reasons"].add("shared-input")
    return propagate_dependencies(registry, affected)


def propagate_dependencies(registry, affected):
    progress = True
    while progress:
        progress = False
        for identifier, module in registry["modules"].items():
            for dependency in module["dependencies"]:
                if affected[dependency]["reasons"] and "dependency:" + dependency not in affected[identifier]["reasons"]:
                    affected[identifier]["reasons"].add("dependency:" + dependency)
                    progress = True
    return affected


def plan(git, base, head, *, release_version=None, changes=None):
    base, head = git.revision(base), git.revision(head)
    registry = git.registry(head)
    previous = git.registry(base, optional=True)
    release_version = release_version or decode(git.blobs(head, ["package.json"])["package.json"])["version"]
    version_tuple(release_version)
    overrides = validate_changes(changes, registry["modules"])
    changed = [path for path in git.changed(base, head) if not any(matches(path, scope) for scope in registry["ignoredPaths"])]
    normalized = set(registry["ignoreVersionOnlyChanges"]) & set(changed) & git.tree(base).keys() & git.tree(head).keys()
    old_files, new_files = git.blobs(base, normalized), git.blobs(head, normalized)
    changed = [path for path in changed if path not in normalized
               or normalized_blob(path, old_files[path], registry) != normalized_blob(path, new_files[path], registry)]
    affected = affected_modules(registry, changed)
    if previous:
        for identifier, module in registry["modules"].items():
            prior = previous["modules"].get(identifier)
            if prior is not None and {key: value for key, value in prior.items() if key != "version"} != {
                    key: value for key, value in module.items() if key != "version"}:
                affected[identifier]["paths"].add(REGISTRY)
                affected[identifier]["reasons"].add("module-policy-change")
        propagate_dependencies(registry, affected)
    proposed = deepcopy(registry)
    rows = {}
    for identifier, module in sorted(registry["modules"].items()):
        prior = previous["modules"].get(identifier) if previous else None
        current = module["version"]
        before = prior["version"] if prior else None
        impacted = bool(affected[identifier]["reasons"])
        selected = overrides.get(identifier, "patch") if impacted else None
        require(identifier not in overrides or impacted, "Bump intent names an unaffected module")
        if prior is None:
            desired, status = current, "initial-baseline"
        else:
            require(version_tuple(current) >= version_tuple(before), "Module version regression")
            expected = bump_version(before, selected) if impacted else before
            desired = current if version_tuple(current) >= version_tuple(expected) else expected
            status = ("bump-required" if desired != current else "already-versioned") if impacted else "unchanged"
        proposed["modules"][identifier]["version"] = desired
        rows[identifier] = {"previousVersion": before, "currentVersion": current, "proposedVersion": desired,
                            "bump": selected, "status": status, "changedPaths": sorted(affected[identifier]["paths"]),
                            "reasons": sorted(affected[identifier]["reasons"])}
    removed = sorted(set(previous["modules"]) - set(registry["modules"])) if previous else []
    require(not removed, "Removing a tracked module requires an explicit registry schema migration")
    return {"schemaVersion": 1, "kind": "warpdrive-module-version-proposal", "baseRevision": base,
            "sourceRevision": head, "releaseVersion": release_version, "bootstrap": previous is None,
            "hasChanges": any(row["status"] == "bump-required" for row in rows.values()),
            "modules": rows, "catalogSha256": digest(registry), "proposedCatalog": proposed,
            "versionMeaning": MEANING, "compatibilityQualified": False,
            "publicationAuthorized": False, "deploymentAuthorized": False}


def validate_identities(value, modules):
    if value is None:
        return {}
    exact(value, {"schemaVersion", "modules"}, "Closed observed module identities required")
    require(type(value["schemaVersion"]) is int and value["schemaVersion"] == 1 and type(value["modules"]) is dict,
            "Versioned observed module identities required")
    require(set(value["modules"]) <= set(modules), "Unknown observed module")
    for row in value["modules"].values():
        exact(row, {"moduleVersion", "sourceRevision", "imageDigest", "runtimeId", "evidence"}, "Closed observed identity required")
        require(row["moduleVersion"] is None or type(row["moduleVersion"]) is str and SEMVER.fullmatch(row["moduleVersion"]), "Observed stable version or null required")
        require(type(row["sourceRevision"]) is str and SHA.fullmatch(row["sourceRevision"]), "Exact observed source revision required")
        require(row["imageDigest"] is None or type(row["imageDigest"]) is str and DIGEST.fullmatch(row["imageDigest"]), "Observed image digest or null required")
        require(row["runtimeId"] is None or type(row["runtimeId"]) is str and re.fullmatch(r"[a-f0-9]{64}", row["runtimeId"]), "Observed runtime identity or null required")
        require(type(row["evidence"]) is dict and row["evidence"], "Observed identity requires independently supplied evidence references")
        for key, evidence in row["evidence"].items():
            require(type(key) is str and MODULE_ID.fullmatch(key) and type(evidence) is str and re.fullmatch(r"[a-f0-9]{64}", evidence),
                    "Named immutable evidence hashes required")
    return value["modules"]


def manifest(git, revision, release_version, *, identities=None):
    revision = git.revision(revision)
    version_tuple(release_version)
    require(decode(git.blobs(revision, ["package.json"])["package.json"])["version"] == release_version,
            "Manifest release version must match the committed package version")
    registry = git.registry(revision)
    observed = validate_identities(identities, registry["modules"])
    tree = git.tree(revision)
    selected = {}
    for identifier, module in registry["modules"].items():
        scopes = module["paths"] + [path for shared in registry["sharedPaths"] if identifier in shared["modules"] for path in shared["paths"]]
        selected[identifier] = sorted(path for path in tree if any(matches(path, scope) for scope in scopes)
                                      and not any(matches(path, scope) for scope in registry["ignoredPaths"]))
    contents = git.blobs(revision, {path for paths in selected.values() for path in paths})
    rows = {}
    for identifier, module in sorted(registry["modules"].items()):
        inventory = [{"path": path, "bytes": len(normalized_blob(path, contents[path], registry)),
                      "sha256": sha256(normalized_blob(path, contents[path], registry)).hexdigest()} for path in selected[identifier]]
        require(inventory, "Every source module requires committed source inputs")
        policy = {key: value for key, value in module.items() if key != "version"}
        rows[identifier] = {"name": module["name"], "kind": module["kind"], "sourceModuleVersion": module["version"],
                            "sourceRevision": revision, "versionDecisionFingerprint": digest({"module": policy, "inputs": inventory}),
                            "sourceInputCount": len(inventory), "dependencies": module["dependencies"],
                            "observedIdentity": deepcopy(observed.get(identifier)),
                            "installedModuleVersionKnown": identifier in observed and observed[identifier]["moduleVersion"] is not None}
    return {"schemaVersion": 1, "kind": "warpdrive-source-module-release-manifest", "releaseVersion": release_version,
            "sourceRevision": revision, "catalogSha256": digest(registry), "versionMeaning": MEANING, "modules": rows,
            "fingerprintScope": "Version-decision source inventory; never a replacement for strict native build-input or image-custody receipts.",
            "observedIdentityScope": "Caller-supplied evidence hashes are references, not independently authenticated runtime acceptance.",
            "compatibilityQualified": False, "publicationAuthorized": False, "deploymentAuthorized": False}


def local_json(path):
    path = Path(path)
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and not path.is_symlink() and 0 < info.st_size <= MAX_JSON, "Bounded regular JSON file required")
    with path.open("rb") as stream:
        raw = stream.read(MAX_JSON + 1)
        require(len(raw) == info.st_size and os.path.samestat(info, os.fstat(stream.fileno())), "JSON file changed during read")
    return decode(raw)


def updated_catalog_bytes(original_raw, proposed_catalog):
    """Replace only reviewed module version tokens, retaining repository formatting."""
    original = validate_registry(decode(original_raw))
    validate_registry(proposed_catalog)
    unchanged = deepcopy(proposed_catalog)
    require(set(original["modules"]) == set(proposed_catalog["modules"]), "Version update cannot change catalog membership")
    for identifier, module in original["modules"].items():
        require(version_tuple(proposed_catalog["modules"][identifier]["version"]) >= version_tuple(module["version"]),
                "Version update cannot regress a module")
        unchanged["modules"][identifier]["version"] = module["version"]
    require(unchanged == original, "Automatic version updates may change only module version fields")
    text = original_raw.decode("utf-8")
    decoder = json.JSONDecoder()
    replacements = []

    def whitespace(index):
        while index < len(text) and text[index] in " \r\n\t":
            index += 1
        return index

    def visit(index, path):
        index = whitespace(index)
        if text[index] == "{":
            index = whitespace(index + 1)
            while text[index] != "}":
                key, end = decoder.raw_decode(text, index)
                require(type(key) is str, "JSON object key required")
                index = whitespace(end)
                require(text[index] == ":", "JSON object separator required")
                index = whitespace(visit(index + 1, (*path, key)))
                if text[index] == "}":
                    break
                require(text[index] == ",", "JSON member separator required")
                index = whitespace(index + 1)
            return index + 1
        if text[index] == "[":
            index = whitespace(index + 1)
            while text[index] != "]":
                index = whitespace(visit(index, (*path, None)))
                if text[index] == "]":
                    break
                require(text[index] == ",", "JSON array separator required")
                index = whitespace(index + 1)
            return index + 1
        _, end = decoder.raw_decode(text, index)
        if len(path) == 3 and path[0] == "modules" and path[2] == "version":
            replacements.append((index, end, json.dumps(proposed_catalog["modules"][path[1]]["version"])))
        return end

    require(whitespace(visit(0, ())) == len(text) and len(replacements) == len(original["modules"]),
            "All exact module version tokens must be located")
    for start, end, replacement in reversed(replacements):
        text = text[:start] + replacement + text[end:]
    raw = text.encode("utf-8")
    require(decode(raw) == proposed_catalog, "Updated catalog differs from the reviewed proposal")
    return raw


def emit(value, output):
    raw = canonical(value) + b"\n"
    if output:
        with Path(output).open("xb") as stream:
            stream.write(raw)
    else:
        sys.stdout.buffer.write(raw)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[2])
    commands = parser.add_subparsers(dest="action", required=True)
    for action in ("plan", "check", "apply"):
        command = commands.add_parser(action)
        command.add_argument("--base", required=True)
        command.add_argument("--head", required=True)
        command.add_argument("--release-version")
        command.add_argument("--changes", type=Path)
        command.add_argument("--output", type=Path)
    command = commands.add_parser("manifest")
    command.add_argument("--revision", required=True)
    command.add_argument("--release-version", required=True)
    command.add_argument("--identities", type=Path)
    command.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    try:
        git = Git(args.repo)
        if args.action == "manifest":
            result = manifest(git, args.revision, args.release_version,
                              identities=local_json(args.identities) if args.identities else None)
        else:
            result = plan(git, args.base, args.head, release_version=args.release_version,
                          changes=local_json(args.changes) if args.changes else None)
            if args.action == "check":
                require(not result["hasChanges"], "Affected source modules require a version proposal")
            elif args.action == "apply":
                path = git.repo / REGISTRY
                require(not path.is_symlink() and local_json(path) == git.registry(result["sourceRevision"]),
                        "Refusing to replace an independently edited worktree registry")
                if result["hasChanges"]:
                    path.write_bytes(updated_catalog_bytes(path.read_bytes(), result["proposedCatalog"]))
                result["catalogUpdated"] = result["hasChanges"]
        emit(result, args.output)
        return 0
    except (VersionError, OSError, subprocess.SubprocessError, UnicodeError) as error:
        print("Module versions held: " + str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
