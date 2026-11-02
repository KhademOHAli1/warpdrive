"""Shared release API, version selection, and stable acceptance identities."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
IDENTITY = re.compile(r"<!-- warpdrive:delivery-id:([^\s]+) -->")
SHA = re.compile(r"^[0-9a-f]{40}$")
VERSION = re.compile(r"^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")
ATTESTATION = re.compile(r"```warpdrive-acceptance\s*\n(.*?)\n```", re.S)
REPO = "KhademOHAli1/warpdrive"

class GateError(RuntimeError):
    pass

def run(*args, binary=False):
    try:
        p = subprocess.run(args, cwd=ROOT, capture_output=True, text=not binary, check=False, timeout=60)
    except subprocess.TimeoutExpired as error:
        raise GateError("Command exceeded 60 seconds; inspect state before resuming") from error
    if p.returncode:
        message = p.stderr.decode() if binary else p.stderr
        raise GateError(f"Command failed ({args[0]}): {message.strip()}")
    return p.stdout

class GitHub:
    def request(self, path, method="GET", payload=None):
        args = ["gh", "api", "-H", "Accept: application/vnd.github+json", "-H", "X-GitHub-Api-Version: 2022-11-28", path, "--method", method]
        if payload is not None:
            args += ["--input", "-"]
        try:
            p = subprocess.run(args, input=json.dumps(payload) if payload is not None else None, capture_output=True, text=True, check=False, timeout=60)
        except subprocess.TimeoutExpired as error:
            raise GateError(f"GitHub {method} exceeded 60 seconds; reread remote state before resuming, no automatic retry was performed") from error
        if p.returncode:
            raise GateError(f"GitHub {method} {path}: {p.stderr.strip()}")
        return json.loads(p.stdout) if p.stdout.strip() else None

    def pages(self, path, key=None):
        result, page = [], 1
        while True:
            sep = "&" if "?" in path else "?"
            data = self.request(f"{path}{sep}per_page=100&page={page}")
            rows = data[key] if key else data
            result.extend(rows)
            if len(rows) < 100:
                return result
            page += 1

def load_json(path):
    return json.loads(Path(path).read_text())

def canonical_json(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))

def scope_hash(item):
    return hashlib.sha256(canonical_json({"id": item["id"], "acceptance": item["acceptance"], "source_tasks": item["source_tasks"]}).encode()).hexdigest()

def version_tuple(value):
    match = VERSION.fullmatch(value)
    if not match:
        raise GateError(f"Expected stable MAJOR.MINOR.PATCH version: {value}")
    return tuple(map(int, match.groups()))

def select_version(package_version, existing, requested=None, bump="patch"):
    current = max([version_tuple(package_version)] + [version_tuple(v) for v in existing if VERSION.fullmatch(v)])
    if requested:
        target = version_tuple(requested)
    elif bump == "major":
        target = (current[0] + 1, 0, 0)
    elif bump == "minor":
        target = (current[0], current[1] + 1, 0)
    else:
        target = (current[0], current[1], current[2] + 1)
    if target <= current:
        raise GateError("Release version must exceed package version and every existing stable tag/release")
    return ".".join(map(str, target))


def validate_release_version(package_version, selected_version, existing):
    selected = version_tuple(selected_version)
    if version_tuple(package_version) != selected:
        raise GateError("Selected release version must equal the committed package version; prepare and integrate the version bump first")
    stable = [version_tuple(v) for v in existing if VERSION.fullmatch(v)]
    if stable and selected <= max(stable):
        raise GateError("Selected release version must exceed every other stable tag/release")

def prepare_package_version(root, selected_version, apply=False):
    """Change only declared version strings, without installation or lock regeneration."""
    root = Path(root)
    package_path, lock_path = root / "package.json", root / "bun.lock"
    raw = package_path.read_text()
    package = json.loads(raw)
    if not package.get("packageManager", "").startswith("bun@"):
        raise GateError("Version preparation requires the declared Bun package manager")
    old, new = package["version"], selected_version.removeprefix("v")
    if version_tuple(new) < version_tuple(old):
        raise GateError("Refusing to lower the package version")
    if old == new:
        return []
    updated, count = re.subn(r'("version"\s*:\s*")[^"]+(")', lambda m: m[1] + new + m[2], raw, count=1)
    expected = dict(package, version=new)
    if count != 1 or json.loads(updated) != expected:
        raise GateError("Cannot isolate the package version safely")
    updates = {package_path: updated}
    lock = lock_path.read_text()
    header = re.search(r'"workspaces"\s*:\s*\{\s*""\s*:\s*\{(.*?)(?="dependencies"\s*:|[}])', lock, re.S)
    if not header:
        raise GateError("Cannot inspect the root Bun lock workspace safely")
    locked = re.search(r'("version"\s*:\s*")([^"]+)(")', header[1])
    if locked:
        if locked[2] != old:
            raise GateError("Bun lock root version differs from package version")
        start = header.start(1) + locked.start(2)
        end = header.start(1) + locked.end(2)
        updates[lock_path] = lock[:start] + new + lock[end:]
    if apply:
        for path, content in updates.items():
            path.write_text(content)
    return [path.name for path in updates]

def load_candidate_json(revision, path):
    """Parse committed candidate data without importing or executing candidate source."""
    from pathlib import PurePosixPath
    candidate = PurePosixPath(path)
    if not isinstance(revision, str) or not SHA.fullmatch(revision) or candidate.is_absolute() or ".." in candidate.parts or not candidate.parts:
        raise GateError("Candidate JSON requires a full revision and repository-relative path")
    return json.loads(run("git", "show", f"{revision}:{candidate.as_posix()}"))

def published_stable_releases(releases, current_tag):
    return [r for r in releases if r.get("draft") is False and not r.get("prerelease", False) and r.get("tag_name") != current_tag and VERSION.fullmatch(r.get("tag_name", ""))]

def release_baseline(releases, tags, current_tag, bootstrap):
    published = published_stable_releases(releases, current_tag)
    if not published:
        return bootstrap
    prior = max(published, key=lambda r: version_tuple(r["tag_name"]))
    tag = next((t for t in tags if t["name"] == prior["tag_name"]), None)
    if not tag:
        raise GateError("Published baseline release is missing its immutable tag")
    return tag["commit"]["sha"]
