"""Admit an explicitly reviewed structural Web Git delta.

The caller authenticates the review digests, supplies complete exact Git trees
and discovers protected runtime paths independently. Graph, byte-content and
runtime qualification are separate from this inventory check.
"""
from __future__ import annotations

from copy import deepcopy
import re
import unicodedata

from candidate import CandidateError, require
import component_inputs as inputs
from web_functional_profile import (
    APP_MARKERS, APP_SEGMENT, GIT_BLOB, MAX_PATH_CHARS, PROTECTED_LEAVES, PROTECTED_SEGMENTS,
    UI_SEGMENT, V2_SCRIPT, V2_STYLE,
)


KIND = "warpdrive-web-structural-delta"
REGISTRY_KIND = "warpdrive-web-structural-registry-repin"
MAX_ENVELOPE_BYTES = 128 * 1024
MAX_OPERATIONS = 256
ENVELOPE_FIELDS = {"kind", "version", "baselineRevision", "candidateRevision", "operations"}
OPERATION_FIELDS = {"path", "role", "operation", "before", "after"}
GIT_KINDS = {"100644": "blob", "100755": "blob", "120000": "blob", "160000": "commit"}
OPERATION_ENDPOINTS = {"add": (False, True), "remove": (True, False), "replace": (True, True)}
ASSET_ROOTS = {"assets", "fonts", "icons", "images"}
ASSET = re.compile(r"([A-Za-z0-9_-]+)\.(?:avif|gif|jpe?g|png|webp|woff2?)\Z")
TEST = re.compile(r"([A-Za-z0-9_-]+)(?:\.[A-Za-z0-9_-]+)*\.test\.tsx?\Z")
SOURCE_ROLES = {"client": V2_SCRIPT, "style": V2_STYLE, "test": TEST}
ROLES = {*SOURCE_ROLES, "asset", "registry-review"}
REGISTRY = re.compile(r"src/features/privacy/registryIds[A-Za-z0-9]+\.ts\Z")
NEXT_METADATA = re.compile(r"(?:icon|apple-icon|opengraph-image|twitter-image)\d*\Z")
WORD_BREAK = re.compile(r"(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|[-_]")
SECURITY_WORDS = {
    "auth", "authentication", "authorization", "config", "credential", "credentials", "csrf", "db",
    "env", "middleware", "mfa", "oauth", "privacy", "proxy", "security", "server", "session",
}


def _matches(pattern, value):
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def _checked_path(path):
    try:
        return inputs.safe_path(path)
    except inputs.InputError as error:
        raise CandidateError("Unsafe structural Web path") from error


def _reserved(name, exact):
    return name.lower() in exact or not SECURITY_WORDS.isdisjoint(word.lower() for word in WORD_BREAK.split(name))


def _scoped_source(parts):
    if parts[:3] == ["src", "app", "(app)"] and len(parts) >= 4:
        directories, segment = parts[3:-1], APP_SEGMENT
    elif parts[:2] == ["src", "components"] and len(parts) >= 3:
        directories, segment = parts[2:-1], UI_SEGMENT
    elif parts[:2] == ["src", "features"] and len(parts) >= 4:
        directories, segment = parts[2:-1], UI_SEGMENT
    else:
        return False
    return all(segment.fullmatch(part) and not _reserved(APP_MARKERS.sub("", part), PROTECTED_SEGMENTS)
               for part in directories)


def _admit_path(path, role, operation):
    if role == "registry-review":
        return operation == "replace" and REGISTRY.fullmatch(path)
    parts = path.split("/")
    if role == "asset":
        match = ASSET.fullmatch(parts[-1])
        return (len(parts) >= 3 and parts[0] == "public" and parts[1] in ASSET_ROOTS and match
                and not _reserved(match[1], PROTECTED_LEAVES)
                and all(UI_SEGMENT.fullmatch(part) and not _reserved(part, PROTECTED_SEGMENTS) for part in parts[2:-1]))
    if not _scoped_source(parts):
        return False
    match = SOURCE_ROLES[role].fullmatch(parts[-1])
    if role == "test" and any(_reserved(part, PROTECTED_SEGMENTS) for part in parts[-1].split(".")[1:-2]):
        return False
    return (match and not _reserved(match[1], PROTECTED_LEAVES | {"page", "layout"})
            and not NEXT_METADATA.fullmatch(match[1].lower()))


def _endpoint(value):
    require(type(value) is dict and set(value) == {"mode", "blob"} and value["mode"] == "100644"
            and _matches(GIT_BLOB, value["blob"]), "Structural Web changes require regular non-executable Git blobs")


def _check_operation(row):
    require(type(row) is dict and set(row) == OPERATION_FIELDS, "Exact structural Web operation required")
    operation, role = row["operation"], row["role"]
    require(isinstance(operation, str) and operation in OPERATION_ENDPOINTS and isinstance(role, str) and role in ROLES,
            "Invalid structural Web operation or role")
    path = _checked_path(row["path"])
    require(len(path) <= MAX_PATH_CHARS and _admit_path(path, role, operation),
            f"Structural Web path cannot be written under role {role}")
    for name, present in zip(("before", "after"), OPERATION_ENDPOINTS[operation], strict=True):
        if present:
            _endpoint(row[name])
        else:
            require(row[name] is None, "Structural Web operation requires an absent Git endpoint")
    require(row["before"] != row["after"], "Structural Web replacement must change the blob")
    return path


def _path_index(paths):
    """Detect ambiguous case, Unicode normalization, and file/directory aliases."""
    index = {}
    for path in paths:
        components = path.split("/")
        for length in range(1, len(components) + 1):
            prefix = "/".join(components[:length])
            key = unicodedata.normalize("NFC", prefix.casefold())
            entry = (prefix, length == len(components))
            require(index.setdefault(key, entry) == entry, "Structural Web tree has a case or path collision")
    return index


def _validate_envelope(value):
    require(type(value) is dict and set(value) == ENVELOPE_FIELDS and value["kind"] == KIND
            and type(value["version"]) is int and value["version"] == 1, "Unsupported structural Web delta")
    baseline, candidate = value["baselineRevision"], value["candidateRevision"]
    require(_matches(GIT_BLOB, baseline) and _matches(GIT_BLOB, candidate) and baseline != candidate,
            "Distinct exact structural Web baseline and candidate revisions required")
    rows = value["operations"]
    require(type(rows) is list and 0 < len(rows) <= MAX_OPERATIONS, "Bounded structural Web operations required")
    paths = [_check_operation(row) for row in rows]
    require(paths == sorted(set(paths)), "Structural Web paths must be unique and sorted")
    _path_index(paths)
    require(len(inputs.canonical(value)) <= MAX_ENVELOPE_BYTES, "Structural Web delta exceeds its canonical byte budget")
    return value


def _verify_digest(value, expected, label):
    require(_matches(inputs.HASH, expected) and inputs.content_hash(value) == expected,
            f"Structural Web {label} differs from its independently reviewed digest")


def parse_web_structural_delta(raw, *, expected_sha256):
    """Parse UTF-8 JSON and bind its canonical form to an independent review."""
    require(type(raw) is bytes and 0 < len(raw) <= MAX_ENVELOPE_BYTES, "Bounded structural Web delta bytes required")
    try:
        value = inputs.decode(raw.decode("utf-8", "strict"))
    except (inputs.InputError, UnicodeError) as error:
        raise CandidateError("Invalid structural Web delta JSON") from error
    _validate_envelope(value)
    _verify_digest(value, expected_sha256, "delta")
    return value


def structural_registry_review(envelope):
    """Return exact digest material for independent privacy re-pin review."""
    _validate_envelope(envelope)
    return deepcopy(_registry_review(envelope))


def _registry_review(envelope):
    rows = [row for row in envelope["operations"] if row["role"] == "registry-review"]
    if not rows:
        return None
    return {
        "kind": REGISTRY_KIND,
        "version": 1,
        "baselineRevision": envelope["baselineRevision"],
        "candidateRevision": envelope["candidateRevision"],
        "operations": rows,
    }


def _check_tree(tree):
    require(type(tree) is dict and len(tree) <= inputs.MAX_FILES, "Complete bounded structural Web Git tree required")
    for path, record in tree.items():
        _checked_path(path)
        require(type(record) is tuple and len(record) == 3 and isinstance(record[0], str)
                and record[0] in GIT_KINDS and record[1] == GIT_KINDS[record[0]] and _matches(GIT_BLOB, record[2]),
                "Invalid structural Web Git tree record")


def _record(endpoint):
    return (endpoint["mode"], "blob", endpoint["blob"]) if endpoint is not None else None


def verify_web_structural_delta(before, after, envelope, *, baseline_revision, candidate_revision,
                                expected_sha256, protected_paths, expected_registry_review_sha256=None):
    """Require the exact reviewed diff across complete trusted Git inventories."""
    _validate_envelope(envelope)
    _verify_digest(envelope, expected_sha256, "delta")
    require(envelope["baselineRevision"] == baseline_revision and envelope["candidateRevision"] == candidate_revision,
            "Structural Web delta belongs to different Git revisions")
    _check_tree(before)
    _check_tree(after)
    require(type(protected_paths) in (tuple, list, set, frozenset) and len(protected_paths) <= inputs.MAX_FILES,
            "Bounded independently discovered protected path inventory required")
    protected = {_checked_path(path) for path in protected_paths}
    paths = before.keys() | after.keys()
    _path_index(paths | protected)
    changed = {path for path in paths if before.get(path) != after.get(path)}
    require(changed.isdisjoint(protected), "Structural Web delta touches an independently protected path")
    rows = envelope["operations"]
    require(changed == {row["path"] for row in rows}, "Structural Web delta does not cover the exact Git tree changes")
    for row in rows:
        path = row["path"]
        require(before.get(path) == _record(row["before"]) and after.get(path) == _record(row["after"]),
                "Structural Web delta Git endpoint differs from its review")
    review = _registry_review(envelope)
    if review is None:
        require(expected_registry_review_sha256 is None, "Unexpected independent structural Web registry review")
    else:
        _verify_digest(review, expected_registry_review_sha256, "registry re-pin")
    return tuple(row["path"] for row in rows)
