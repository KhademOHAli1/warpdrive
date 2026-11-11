"""Independently verify component input receipts; never authorize image reuse by hash alone.

Offline validation binds the declared inventory. Current-source verification additionally
runs fresh dependency discovery: a self-consistent old list cannot hide a newly added import.
Trusted image provenance and assembly qualification remain separate admission requirements.
"""
from __future__ import annotations

import argparse
from contextlib import ExitStack
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import signal
import stat
import subprocess
import sys
import threading

COMPONENTS = ("web", "worker", "realtime", "migrator")
TOP_KEYS = {"schemaVersion", "kind", "inputPolicySha256", "policy", "context", "components"}
COMPONENT_KEYS = {"inputPolicySha256", "componentInputSha256", "graphInputs", "inputs", "helperEntries", "graphKind", "limitations"}
POLICY_KEYS = {"version", "context", "sharedFiles", "sharedTrees", "rootTsconfigFiles", "runtimeAssets", "limits", "policySources", "entries", "esbuild", "web", "revision"}
POLICY_SOURCES = {"scripts/build-workers.mjs", "scripts/deployment/component_inputs.mjs"}
HASH = re.compile(r"[a-f0-9]{64}\Z")
# Match the retained bundle metadata ceiling, so oversize evidence holds before builds.
MAX_JSON_BYTES = 4 * 1024 * 1024
MAX_FILES = 20_000
MAX_FILE_BYTES = 32 * 1024 * 1024
MAX_TOTAL_BYTES = 256 * 1024 * 1024
MAX_GRAPH_INPUTS = 10_000
REVISION_POLICY = "excluded-provenance-original-image-source-must-be-preserved"


class InputError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise InputError(message)


def canonical(value):
    def bounded(item, depth=0):
        require(depth <= 32, "input metadata nesting exceeds bound")
        if isinstance(item, dict):
            require(all(isinstance(key, str) for key in item), "string input metadata keys required")
            for key, child in item.items():
                bounded(key, depth + 1)
                bounded(child, depth + 1)
        elif isinstance(item, list):
            for child in item:
                bounded(child, depth + 1)
        elif isinstance(item, str):
            try:
                item.encode("utf-8", "strict")
            except UnicodeError as error:
                raise InputError("well-formed input metadata Unicode required") from error
        else:
            require(item is None or type(item) is bool or (type(item) is int and abs(item) <= 2 ** 53 - 1),
                    "canonical input numbers must be safe integers")
    bounded(value)
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8")


def content_hash(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def safe_path(value):
    require(isinstance(value, str) and 0 < len(value) <= 2048 and not value.startswith("/")
            and "\\" not in value and not any(ord(char) < 32 or ord(char) == 127 for char in value)
            and all(part not in {"", ".", ".."} for part in value.split("/"))
            and len(value.split("/")) <= 64, "unsafe component input path")
    canonical(value)
    require(not PurePosixPath(value).is_absolute(), "absolute component input path refused")
    return value


def _paths(value, maximum=MAX_FILES):
    require(isinstance(value, list) and len(value) <= maximum, "bounded input path list required")
    require(all(isinstance(item, str) for item in value), "input paths must be strings")
    require(value == sorted(set(value)), "input paths must be unique and UTF-8 ordered")
    for item in value:
        safe_path(item)
    return value


def _records(value):
    require(isinstance(value, list) and 0 < len(value) <= MAX_FILES, "bounded nonempty input inventory required")
    total = 0
    for record in value:
        require(isinstance(record, dict) and set(record) == {"path", "sha256", "bytes"}, "exact input file record required")
        safe_path(record["path"])
        require(isinstance(record["sha256"], str) and HASH.fullmatch(record["sha256"])
                and type(record["bytes"]) is int and 0 <= record["bytes"] <= MAX_FILE_BYTES,
                "invalid input file digest or size")
        total += record["bytes"]
    require(total <= MAX_TOTAL_BYTES, "component input byte budget exceeded")
    _paths([record["path"] for record in value])
    return {record["path"]: record for record in value}


def _context(value):
    require(isinstance(value, dict) and set(value) == {"baseImage", "platform", "buildArgs"}, "complete input context required")
    require(isinstance(value["baseImage"], str) and re.fullmatch(r"oven/bun@sha256:[a-f0-9]{64}", value["baseImage"])
            and value["platform"] == "linux/amd64", "immutable qualified base and platform required")
    args = value["buildArgs"]
    require(isinstance(args, dict) and set(args) == {"APP_VERSION", "NEXT_PUBLIC_WS_URL"}, "explicit semantic build arguments required")
    for item in args.values():
        require(isinstance(item, str) and len(item) <= 4096
                and not any(ord(char) < 32 or ord(char) == 127 for char in item), "unsafe semantic build argument")


def validate_receipt(value, *, components=COMPONENTS):
    """Validate declared evidence only; this does not prove discovery or trusted build origin."""
    require(isinstance(value, dict) and set(value) == TOP_KEYS and type(value["schemaVersion"]) is int
            and value["schemaVersion"] == 1 and value["kind"] == "warpdrive-component-inputs", "unsupported component input receipt")
    require(isinstance(components, (tuple, list)) and len(components) > 0 and len(set(components)) == len(components)
            and set(components).issubset(COMPONENTS), "explicit qualified component selection required")
    _context(value["context"])
    policy = value["policy"]
    require(isinstance(policy, dict) and set(policy) == POLICY_KEYS and type(policy["version"]) is int
            and policy["version"] == 1 and policy["context"] == value["context"]
            and policy["revision"] == REVISION_POLICY and policy["rootTsconfigFiles"] is True, "complete component input policy required")
    limits = policy["limits"]
    require(limits == {"files": MAX_FILES, "fileBytes": MAX_FILE_BYTES, "totalBytes": MAX_TOTAL_BYTES, "graphInputs": MAX_GRAPH_INPUTS}
            and all(type(number) is int for number in limits.values()), "qualified input resource limits required")
    require(isinstance(value["inputPolicySha256"], str) and HASH.fullmatch(value["inputPolicySha256"])
            and value["inputPolicySha256"] == content_hash(policy), "input policy digest differs")
    require(isinstance(value["components"], dict) and set(value["components"]) == set(components), "complete selected component inventory required")
    source_records = _records(policy["policySources"])
    require(set(source_records) == POLICY_SOURCES, "both discovery policy source files required")
    shared = policy["sharedFiles"]
    require(isinstance(shared, list) and 0 < len(shared) <= 128 and all(isinstance(path, str) for path in shared)
            and len(set(shared)) == len(shared), "bounded shared input declaration required")
    for path in shared:
        safe_path(path)
    require(isinstance(policy["entries"], dict) and set(policy["entries"]) == set(COMPONENTS), "all helper entrypoint declarations required")
    all_records = {}
    for name in components:
        component = value["components"][name]
        require(isinstance(component, dict) and set(component) == COMPONENT_KEYS, "exact component input fields required")
        records = _records(component["inputs"])
        require(set(shared).issubset(records) and all(records.get(path) == record for path, record in source_records.items()),
                "component omits or changes shared policy inputs")
        for path, record in records.items():
            require(path not in all_records or all_records[path] == record, "one input path has conflicting component contents")
            all_records[path] = record
        require(component["inputPolicySha256"] == value["inputPolicySha256"]
                and component["componentInputSha256"] == content_hash({"inputPolicySha256": value["inputPolicySha256"], "inputs": component["inputs"]}),
                "component input digest differs")
        graph = _paths(component["graphInputs"], MAX_GRAPH_INPUTS)
        require(len(graph) > 0 and set(graph).issubset(records), "fresh graph inputs absent from inventory")
        helpers = component["helperEntries"]
        require(isinstance(helpers, list) and 0 < len(helpers) <= 16 and helpers == policy["entries"][name], "helper entrypoints differ from policy")
        for entry in helpers:
            require(isinstance(entry, dict) and set(entry) == {"in", "out"}, "exact helper entrypoint required")
            safe_path(entry["in"])
            safe_path(entry["out"])
            require(entry["in"] in graph and entry["out"].startswith("dist/"), "helper source or output missing")
        expected_graph = "esbuild-helpers-plus-conservative-repository-sources" if name == "web" else "fresh-esbuild-transitive-application-inputs"
        require(component["graphKind"] == expected_graph, "unqualified component graph mode")
        require(isinstance(component["limitations"], list) and 0 < len(component["limitations"]) <= 16
                and all(isinstance(item, str) and 0 < len(item) <= 2048 for item in component["limitations"]), "explicit component input limitations required")
    canonical(value)
    return value


def verify_files(root, value, *, components=COMPONENTS):
    """Hash beneath an opened directory; no symlink ancestor can redirect a file read."""
    validate_receipt(value, components=components)
    records = {item["path"]: item for component in value["components"].values() for item in component["inputs"]}
    with ExitStack() as opened:
        directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        opened.callback(os.close, directory)
        for path, expected in records.items():
            with ExitStack() as nested:
                parent = directory
                pieces = path.split("/")
                for piece in pieces[:-1]:
                    parent = os.open(piece, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
                    nested.callback(os.close, parent)
                descriptor = os.open(pieces[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
                with os.fdopen(descriptor, "rb") as source:
                    before = os.fstat(source.fileno())
                    require(stat.S_ISREG(before.st_mode) and before.st_size == expected["bytes"], "input file type or size changed")
                    digest = hashlib.sha256()
                    for chunk in iter(lambda: source.read(1024 * 1024), b""):
                        digest.update(chunk)
                    after = os.fstat(source.fileno())
                    require((before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns)
                            == (after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
                            and digest.hexdigest() == expected["sha256"], "input file changed or digest differs")
    return value


def _discover(arguments, root, environment, *, allow_empty=False, deadline_seconds=120):
    """Bound stdout while reading and terminate only this owned process group on failure."""
    with subprocess.Popen(arguments, cwd=root, env=environment, stdout=subprocess.PIPE,
                          stderr=subprocess.DEVNULL, start_new_session=True) as process:
        expired = threading.Event()
        stopped = False
        stop_lock = threading.Lock()
        def stop():
            nonlocal stopped
            with stop_lock:
                if stopped:
                    return
                stopped = True
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
        def timeout():
            expired.set()
            stop()
        timer = threading.Timer(deadline_seconds, timeout)
        timer.start()
        try:
            chunks, total = [], 0
            while chunk := process.stdout.read1(65536):
                total += len(chunk)
                if total > MAX_JSON_BYTES:
                    stop()
                    raise InputError("fresh component input discovery exceeds byte budget")
                chunks.append(chunk)
            code = process.wait(timeout=5)
            require(not expired.is_set() and code == 0 and (total > 0 or allow_empty), "fresh component input discovery failed")
            return b"".join(chunks)
        finally:
            timer.cancel()
            if process.poll() is None:
                stop()
            process.wait(timeout=5)


def verify_source_revision(root, value, revision):
    """Candidate creation requires a clean selected checkout, including every declared input."""
    require(isinstance(revision, str) and re.fullmatch(r"[a-f0-9]{40}", revision), "full build source revision required")
    # Do not trust index stat caches or assume-unchanged/skip-worktree flags: verify
    # the actual files, then independently bind their SHA-256s to raw HEAD blobs.
    verify_files(root, value, components=tuple(value["components"]))
    environment = {key: os.environ[key] for key in ("PATH", "HOME", "TMPDIR") if key in os.environ}
    prefix = ["git", "--no-replace-objects", "-c", "core.fsmonitor=false"]
    head = _discover([*prefix, "rev-parse", "HEAD"], root, environment, deadline_seconds=15).strip()
    require(head == revision.encode("ascii"), "selected build source differs from checkout HEAD")
    _discover([*prefix, "diff", "--no-ext-diff", "--no-textconv", "--quiet", "HEAD", "--"], root, environment,
              allow_empty=True, deadline_seconds=15)
    tree = _discover([*prefix, "ls-tree", "-rz", revision], root, environment, deadline_seconds=15)
    tracked = {}
    for entry in tree.rstrip(b"\0").split(b"\0"):
        metadata, path = entry.split(b"\t", 1)
        mode, kind, identifier = metadata.decode("ascii").split(" ")
        tracked[path.decode("utf-8", "strict")] = (mode, kind, identifier)
    blobs = {}
    for component in value["components"].values():
        for record in component["inputs"]:
            require(record["path"] in tracked, "component input is not retained in the selected Git source")
            mode, kind, identifier = tracked[record["path"]]
            require(mode in {"100644", "100755"} and kind == "blob"
                    and re.fullmatch(r"[a-f0-9]{40}", identifier), "regular HEAD input blob required")
            expected = {"sha256": record["sha256"], "bytes": record["bytes"]}
            require(identifier not in blobs or blobs[identifier] == expected, "conflicting HEAD input contents")
            blobs[identifier] = expected
    _verify_head_blobs([*prefix, "cat-file", "--batch"], root, environment, blobs)


def _verify_head_blobs(arguments, root, environment, blobs):
    """Stream exact Git object contents without filters, index state, or a shell."""
    with subprocess.Popen(arguments, cwd=root, env=environment, stdin=subprocess.PIPE,
                          stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, start_new_session=True) as process:
        expired = threading.Event()
        def stop():
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        def timeout():
            expired.set()
            stop()
        timer = threading.Timer(120, timeout)
        timer.start()
        try:
            for identifier, expected in blobs.items():
                process.stdin.write(identifier.encode("ascii") + b"\n")
                process.stdin.flush()
                header = process.stdout.readline(128)
                require(header == f"{identifier} blob {expected['bytes']}\n".encode("ascii"),
                        "HEAD input blob identity or byte count differs")
                digest = hashlib.sha256()
                remaining = expected["bytes"]
                while remaining:
                    chunk = process.stdout.read(min(1024 * 1024, remaining))
                    require(bool(chunk), "HEAD input blob ended early")
                    digest.update(chunk)
                    remaining -= len(chunk)
                require(process.stdout.read(1) == b"\n" and digest.hexdigest() == expected["sha256"],
                        "component input differs from exact HEAD blob contents")
            process.stdin.close()
            require(process.stdout.read(1) == b"" and process.wait(timeout=5) == 0 and not expired.is_set(),
                    "HEAD input blob verification failed")
        finally:
            timer.cancel()
            if process.poll() is None:
                stop()
            process.wait(timeout=5)


def verify_current(root, value, *, components=COMPONENTS, expected_revision=None):
    """Freshly resolve the entire graph/policy, not merely hash a supplied old file list."""
    verify_files(root, value, components=components)
    if expected_revision is not None:
        verify_source_revision(root, value, expected_revision)
    require(tuple(components) == COMPONENTS or len(components) == 1, "CLI discovery admits one component or the full assembly")
    context = value["context"]
    arguments = ["node", "scripts/deployment/component_inputs.mjs", "--root", str(Path(root).resolve()),
                 "--base-image", context["baseImage"], "--platform", context["platform"]]
    for key in sorted(context["buildArgs"]):
        arguments.extend(["--build-arg", key + "=" + context["buildArgs"][key]])
    if len(components) == 1:
        arguments.extend(["--component", components[0]])
    environment = {key: os.environ[key] for key in ("PATH", "HOME", "TMPDIR") if key in os.environ}
    fresh = decode(_discover(arguments, root, environment))
    validate_receipt(fresh, components=components)
    require(canonical(fresh) == canonical(value), "fresh dependency discovery differs from retained input receipt")
    # Recheck file contents after discovery, including input/tree membership from its fresh pass.
    verify_files(root, value, components=components)
    if expected_revision is not None:
        verify_source_revision(root, value, expected_revision)
    return value


def decode(raw):
    require(isinstance(raw, (str, bytes)) and 0 < len(raw) <= MAX_JSON_BYTES, "bounded input receipt required")
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, "duplicate input receipt field")
            result[key] = value
        return result
    try:
        value = json.loads(raw, object_pairs_hook=unique)
    except (ValueError, UnicodeError, RecursionError) as error:
        raise InputError("invalid input receipt JSON") from error
    return value


def load_receipt(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as source:
        before = os.fstat(source.fileno())
        require(stat.S_ISREG(before.st_mode) and 0 < before.st_size <= MAX_JSON_BYTES,
                "bounded regular input receipt required")
        raw = source.read(MAX_JSON_BYTES + 1)
        after = os.fstat(source.fileno())
        require((before.st_size, before.st_mtime_ns, before.st_ctime_ns)
                == (after.st_size, after.st_mtime_ns, after.st_ctime_ns), "input receipt changed while reading")
    return decode(raw)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--receipt", type=Path, required=True)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--component", choices=COMPONENTS)
    args = parser.parse_args(argv)
    try:
        value = load_receipt(args.receipt)
        components = (args.component,) if args.component else COMPONENTS
        verify_current(args.root, value, components=components)
        print(json.dumps({"inputPolicySha256": value["inputPolicySha256"], "components": list(components),
                          "currentInputEquivalence": True, "deploymentAuthorized": False}))
    except (InputError, OSError, ValueError, TypeError, KeyError, subprocess.TimeoutExpired) as error:
        print("Component inputs rejected: " + type(error).__name__, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
