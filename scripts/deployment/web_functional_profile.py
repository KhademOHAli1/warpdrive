"""Parse reviewed functional Web profiles and classify exact Git tree changes.

The profile identifies source files and adapter interfaces. The JavaScript
verifier must independently check client code, imports, calls and reachability.
"""
from __future__ import annotations

import re

from candidate import CandidateError, require
import component_inputs as inputs


MAX_PROFILE_BYTES = 64 * 1024
MAX_ROLE_FILES = 64
MAX_CAPABILITIES = 32
MAX_EXPORTS = 16
MAX_CAPABILITY_BINDINGS = 512
MAX_PATH_CHARS = 240
ROLES = ("modules", "styles", "adapters")
V1_KEYS = {"version", *ROLES}
V2_KEYS = V1_KEYS | {"capabilities"}
GIT_BLOB = re.compile(r"[a-f0-9]{40}\Z")

# Preserve the v1 path grammar used by web_functional_source.mjs. V2 adds
# explicitly enumerated route-local leaves under the authenticated app group.
V1_ISLAND = re.compile(r"^src/(?:components/|features/[a-z0-9_-]+/ui/)(?:[a-z0-9_-]+/)*[a-z0-9_-]+",
                       re.I | re.ASCII)
V1_UI = re.compile(r"src/(?:app|components|features)/[a-z0-9_./()@\[\]-]+\.tsx?\Z", re.I | re.ASCII)
V1_STYLE = re.compile(r"[a-z0-9_./-]+\.module\.css\Z", re.I | re.ASCII)
V1_EXCLUDED = re.compile(
    r"(?:^|/)(?:index|route|actions?|server|middleware|proxy|instrumentation|[^/]+\.(?:test|spec|stories|d))\.[cm]?[jt]sx?\Z",
    re.I | re.ASCII,
)
V1_PROTECTED = re.compile(
    r"^(?:src/features/[^/]+/(?:server|actions|routers|jobs)/|src/app/(?:.*/)?"
    r"(?:route|robots|sitemap|manifest|icon\d*|apple-icon\d*|opengraph-image\d*|twitter-image\d*)\.)",
    re.ASCII,
)

UI_SEGMENT = re.compile(r"[A-Za-z0-9_-]+\Z")
APP_SEGMENT = re.compile(
    r"(?:@[A-Za-z0-9_-]+|\([A-Za-z0-9_-]+\)|(?:\(\.\)|\(\.\.\)|\(\.\.\.\)|\(\.\.\)\(\.\.\))?"
    r"(?:[A-Za-z0-9_-]+|\[(?:\.\.\.)?[A-Za-z0-9_-]+\]|\[\[\.\.\.[A-Za-z0-9_-]+\]\]))\Z"
)
APP_MARKERS = re.compile(r"[()@\[\].]+")
V2_SCRIPT = re.compile(r"([A-Za-z0-9_-]+)\.tsx?\Z")
V2_STYLE = re.compile(r"([A-Za-z0-9_-]+)\.module\.css\Z")
HOOK = re.compile(r"use[A-Z][A-Za-z0-9]{0,60}\Z")
COMPONENT = re.compile(r"[A-Z][A-Za-z0-9]{0,63}\Z")
PROTECTED_SEGMENTS = {"api", "auth", "actions", "action", "server", "db", "config", "jobs", "routers", "trpc", "migrations"}
PROTECTED_LEAVES = PROTECTED_SEGMENTS | {
    "index", "route", "middleware", "proxy", "instrumentation", "instrumentation-client",
    "loading", "error", "global-error", "global-not-found", "not-found", "template", "default",
    "forbidden", "unauthorized", "robots", "sitemap", "manifest", "favicon", "opengraph-image", "twitter-image",
}


def _v1_path(path, role):
    if role == "styles":
        return V1_ISLAND.match(path) and V1_STYLE.fullmatch(path)
    if not V1_UI.fullmatch(path) or V1_EXCLUDED.search(path):
        return False
    return bool(V1_ISLAND.match(path)) if role == "modules" else not V1_PROTECTED.match(path)


def _v2_path(path, role):
    parts = path.split("/")
    if len(parts) < 3 or parts[0] != "src":
        return False
    app = parts[1:3] == ["app", "(app)"]
    if app and role != "capability":
        directories = parts[3:-1]
        segment = APP_SEGMENT
    elif parts[1] == "components":
        directories = parts[2:-1]
        segment = UI_SEGMENT
    elif len(parts) >= 5 and parts[1] == "features" and parts[3] == "ui":
        directories = [parts[2], *parts[4:-1]]
        segment = UI_SEGMENT
    else:
        return False
    if any(not segment.fullmatch(part) or APP_MARKERS.sub("", part.lower()) in PROTECTED_SEGMENTS
           for part in directories):
        return False
    match = (V2_STYLE if role == "styles" else V2_SCRIPT).fullmatch(parts[-1])
    if not match:
        return False
    leaf = match[1].lower()
    if leaf in {"page", "layout"}:
        return app and role == "adapters"
    return leaf not in PROTECTED_LEAVES and not re.fullmatch(r"(?:icon|apple-icon|opengraph-image|twitter-image)\d*", leaf)


def _checked_path(path, role, version):
    require(isinstance(path, str) and len(path) <= MAX_PATH_CHARS, "Bounded functional Web path required")
    try:
        inputs.safe_path(path)
    except inputs.InputError as error:
        raise CandidateError(f"Unsafe functional Web {role} path") from error
    admit = _v1_path if version == 1 else _v2_path
    require(admit(path, role), f"Invalid functional Web {role} path")
    return path


def _path_list(value, role, version):
    require(type(value) is list and len(value) <= MAX_ROLE_FILES, f"Bounded functional Web {role} list required")
    result = [_checked_path(path, role, version) for path in value]
    require(result == sorted(set(result)), f"Functional Web {role} paths must be unique and sorted")
    return result


def _export_list(value):
    require(type(value) is list and 0 < len(value) <= MAX_EXPORTS, "Bounded capability export list required")
    result = []
    for item in value:
        require(type(item) is dict and set(item) == {"name", "kind"}
                and isinstance(item["name"], str) and isinstance(item["kind"], str),
                "Exact named capability export required")
        kind, name = item["kind"], item["name"]
        require((kind == "hook" and HOOK.fullmatch(name)) or (kind == "component" and COMPONENT.fullmatch(name)),
                "Invalid capability export name or kind")
        result.append(name)
    require(result == sorted(set(result)), "Capability exports must be unique and sorted by name")


def _capability_paths(value, modules):
    require(type(value) is list and len(value) <= MAX_CAPABILITIES, "Bounded functional Web capability list required")
    paths, bindings = [], 0
    for item in value:
        require(type(item) is dict and set(item) == {"path", "exports", "consumers"},
                "Exact frozen capability adapter contract required")
        paths.append(_checked_path(item["path"], "capability", 2))
        _export_list(item["exports"])
        consumers = _path_list(item["consumers"], "modules", 2)
        require(consumers and set(consumers) <= modules, "Capability consumers must be exact declared mutable modules")
        bindings += len(consumers) * len(item["exports"])
    require(paths == sorted(set(paths)) and bindings <= MAX_CAPABILITY_BINDINGS,
            "Capability paths or total named grants exceed the profile bounds")
    return paths


def validate_web_functional_profile(value):
    """Return a strictly bounded, canonicalizable v1 or v2 profile."""
    require(type(value) is dict and type(value.get("version")) is int, "Functional Web profile version required")
    version = value["version"]
    require((version == 1 and set(value) == V1_KEYS) or (version == 2 and set(value) == V2_KEYS),
            "Unsupported functional Web profile")
    roles = {role: _path_list(value[role], role, version) for role in ROLES}
    require(roles["modules"] and roles["adapters"], "Functional Web profile requires modules and render adapters")
    paths = [path for role in ROLES for path in roles[role]]
    if version == 2:
        paths.extend(_capability_paths(value["capabilities"], set(roles["modules"])))
        require(len(set(map(str.lower, paths))) == len(paths), "Functional Web roles cannot overlap or differ only by case")
    else:
        require(len(set(paths)) == len(paths), "Functional Web roles cannot overlap")
    require(len(inputs.canonical(value)) <= MAX_PROFILE_BYTES, "Functional Web profile exceeds its canonical byte budget")
    return value


def parse_web_functional_profile(raw, *, expected_sha256=None):
    """Read bounded JSON and optionally verify the reviewed canonical digest."""
    require(type(raw) is bytes and 0 < len(raw) <= MAX_PROFILE_BYTES, "Bounded functional Web profile bytes required")
    try:
        value = inputs.decode(raw.decode("utf-8", "strict"))
    except (inputs.InputError, UnicodeError) as error:
        raise CandidateError("Invalid functional Web profile JSON") from error
    validate_web_functional_profile(value)
    if expected_sha256 is not None:
        require(isinstance(expected_sha256, str) and inputs.HASH.fullmatch(expected_sha256)
                and inputs.content_hash(value) == expected_sha256,
                "Functional Web profile differs from its reviewed checksum")
    return value


def mutable_web_paths(profile):
    profile = validate_web_functional_profile(profile)
    return frozenset(profile["modules"] + profile["styles"])


def frozen_web_paths(profile):
    profile = validate_web_functional_profile(profile)
    return frozenset([*profile["adapters"], *(item["path"] for item in profile.get("capabilities", []))])


def _regular_blob(record):
    return type(record) is tuple and len(record) == 3 and record[:2] == ("100644", "blob") and (
        isinstance(record[2], str) and GIT_BLOB.fullmatch(record[2]))


def verify_web_functional_delta(before, after, profile):
    """Verify path and mode boundaries over two exact Git tree inventories."""
    profile = validate_web_functional_profile(profile)
    mutable = set(profile["modules"] + profile["styles"])
    reviewed = mutable | set(profile["adapters"]) | {item["path"] for item in profile.get("capabilities", [])}
    require(type(before) is dict and type(after) is dict and before.keys() == after.keys()
            and len(before) <= inputs.MAX_FILES, "Functional Web Git source membership changed or exceeds its bound")
    require(all(_regular_blob(before.get(path)) and _regular_blob(after.get(path)) for path in reviewed),
            "Reviewed functional Web paths must remain pre-existing regular non-executable blobs")
    changed = tuple(sorted(path for path in before if before[path] != after[path]))
    require(changed and set(changed) <= mutable, "Functional Web candidate changed a protected path or made no reviewed change")
    return changed
