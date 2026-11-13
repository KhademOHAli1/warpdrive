"""Admit a narrowly scoped Web build against independently authenticated baseline facts.

The caller owns artifact origin, immutable registry and installed baseline authentication.
This module binds those facts to source inputs. It neither accepts an authentication flag
nor provides a JSON/CLI path that can turn declarations into authenticated facts.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re

import component_inputs as inputs
from engine_image_smoke import CONTEXT, context_record
from registry_candidate import RegistryError, validate_repository_prefix


REVISION = re.compile(r"[0-9a-f]{40}\Z")
IMAGE_ID = re.compile(r"sha256:[0-9a-f]{64}\Z")
REGULAR_MODES = {"100644", "100755"}
RETAINED = ("worker", "realtime", "migrator", "engine", "ingress")
ENGINE_ROOT = CONTEXT.relative_to(CONTEXT.parents[2]).as_posix()
ENGINE_CONTEXT_VERSION = "native-engine-context-v1"
RUNTIME_PROFILE = "core-four-newsletter-caddy-v1"
RUNTIME_FILES = (
    ".dockerignore",
    ".env.example",
    "Caddyfile",
    "Dockerfile",
    "deploy/images/Dockerfile",
    "deploy/images/compose.yml",
    "deploy/newsletters/Caddyfile",
    "docker-compose.newsletters.yml",
    "docker-compose.yml",
    "src/config/authEnv.ts",
    "src/config/clientEnv.ts",
    "src/config/coreEnv.ts",
    "src/config/env.ts",
    "src/config/mailEnv.ts",
)
STYLE_FILE = "src/components/shell/TopBar.module.css"
COPY_FILES = tuple(f"src/components/data-table/messages/tableControls.{locale}.json"
                   for locale in ("de", "en", "fa"))
COPY_KEY = "clearSelection"
STYLE_PROPERTIES = ("border-radius", "gap", "height", "padding-inline")
STYLE_VALUE = re.compile(
    r"(?m)^( {2,4}(?:" + "|".join(STYLE_PROPERTIES) + r"): )([0-9]{1,3})(px;)$"
)
MAX_STYLE_PX = 128
MAX_PRESENTATION_BYTES = 64 * 1024
GIT = ("git", "--no-replace-objects", "-c", "core.fsmonitor=false")


class WebReleaseInputError(ValueError):
    """Input equality or source scope could not be established."""


@dataclass(frozen=True)
class AuthenticatedBaseline:
    """Facts issued by the caller's independent accepted-baseline resolver.

    release_revision and core_input_receipt describe the accepted source assembly.
    Each component row preserves its actual original image ID, digest and build source.
    The caller must already have verified those rows against original qualification
    and immutable registry config, and bound the observed runtime configuration to
    the accepted target. authority_sha256 binds that evidence to the resulting plan.
    Constructing this class proves none of those facts.
    """

    release_revision: str
    core_input_receipt: dict
    core_input_receipt_sha256: str
    components: dict
    runtime_policy_sha256: str
    runtime_config_sha256: str
    authority_sha256: str


def require(condition, message):
    if not condition:
        raise WebReleaseInputError(message)


def _matches(pattern, value):
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def _git(root, *arguments, allow_empty=False):
    # Object IDs and paths come from the validated tree, never a shell.
    environment = {key: os.environ[key] for key in ("PATH", "HOME", "TMPDIR") if key in os.environ}
    return inputs._discover([*GIT, *arguments], root, environment,
                            allow_empty=allow_empty, deadline_seconds=15)


def _tree(root, revision):
    require(_matches(REVISION, revision), "Full exact Git revision required")
    require(_git(root, "rev-parse", "--show-prefix") == b"\n", "Repository root required")
    require(_git(root, "rev-parse", "--verify", revision + "^{commit}").strip() == revision.encode("ascii"),
            "Git revision must identify an exact commit")
    raw = _git(root, "ls-tree", "-rz", "--full-tree", revision)
    require(raw.endswith(b"\0"), "Complete Git tree output required")
    rows = {}
    for entry in raw[:-1].split(b"\0"):
        metadata, path_bytes = entry.split(b"\t", 1)
        mode, kind, object_id = metadata.decode("ascii").split(" ")
        path = inputs.safe_path(path_bytes.decode("utf-8", "strict"))
        require(path not in rows and _matches(REVISION, object_id), "Invalid Git tree member")
        rows[path] = (mode, kind, object_id)
    require(len(rows) <= inputs.MAX_FILES, "Git tree exceeds the admission file budget")
    return rows


def _regular_blob(tree, path):
    require(path in tree, "Required source path is absent from the Git tree")
    mode, kind, object_id = tree[path]
    require(mode in REGULAR_MODES and kind == "blob", "Regular Git source blob required")
    return mode, object_id


def _blob(root, tree, path, maximum):
    mode, object_id = _regular_blob(tree, path)
    raw = _git(root, "cat-file", "blob", object_id, allow_empty=True)
    require(len(raw) <= maximum, "Source blob exceeds the admission byte budget")
    return mode, raw


def _record(root, tree, path, maximum):
    mode, raw = _blob(root, tree, path, maximum)
    return {"path": path, "mode": mode, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}


def _source_policy(root, tree):
    runtime = {
        "schemaVersion": 1,
        "profile": RUNTIME_PROFILE,
        "files": [_record(root, tree, path, inputs.MAX_JSON_BYTES) for path in RUNTIME_FILES],
    }
    prefix = ENGINE_ROOT + "/"
    engine_paths = sorted(path for path in tree if path.startswith(prefix))
    require(0 < len(engine_paths) <= 256, "Bounded Engine context required")
    engine_files = {}
    engine_modes = {}
    engine_bytes = 0
    for path in engine_paths:
        relative = path.removeprefix(prefix)
        require("__pycache__" not in relative.split("/") and not Path(relative).name.startswith(".env")
                and not relative.endswith(".pyc"), "Engine context contains an unsupported input")
        record = _record(root, tree, path, 2 * 1024**2)
        engine_files[relative] = record["sha256"]
        engine_modes[relative] = record["mode"]
        engine_bytes += record["bytes"]
    require(engine_bytes <= 8 * 1024**2, "Engine context exceeds the admitted byte budget")
    # Match the existing native Engine image label, including its JSON encoding.
    engine_digest = hashlib.sha256(json.dumps(engine_files, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return {
        "runtimePolicy": runtime,
        "runtimePolicySha256": inputs.content_hash(runtime),
        "engineContextVersion": ENGINE_CONTEXT_VERSION,
        "engineContextSha256": engine_digest,
        "engineContextTreeSha256": inputs.content_hash({"files": engine_files, "modes": engine_modes}),
    }


def source_policy(root: Path, revision: str) -> dict:
    """Compute source-only Engine and runtime policy evidence from exact Git blobs."""
    return _source_policy(root, _tree(root, revision))


def _verify_baseline_blobs(root, tree, receipt):
    blobs = {}
    for component in receipt["components"].values():
        for record in component["inputs"]:
            _, object_id = _regular_blob(tree, record["path"])
            expected = {"bytes": record["bytes"], "sha256": record["sha256"]}
            require(object_id not in blobs or blobs[object_id] == expected, "Conflicting baseline source blob facts")
            blobs[object_id] = expected
    environment = {key: os.environ[key] for key in ("PATH", "HOME", "TMPDIR") if key in os.environ}
    # Historical build code is never run. The authenticated receipt binds the original
    # discovery, and the existing raw blob reader independently checks its file records.
    inputs._verify_head_blobs([*GIT, "cat-file", "--batch"], root, environment, blobs)


def _baseline_components(baseline):
    require(isinstance(baseline, AuthenticatedBaseline), "Authenticated baseline resolver facts required")
    require(_matches(REVISION, baseline.release_revision)
            and all(_matches(inputs.HASH, value) for value in (
                baseline.core_input_receipt_sha256, baseline.runtime_policy_sha256,
                baseline.runtime_config_sha256, baseline.authority_sha256,
            )), "Exact baseline provenance and runtime policy binding required")
    receipt = inputs.validate_receipt(baseline.core_input_receipt)
    require(inputs.content_hash(receipt) == baseline.core_input_receipt_sha256,
            "Authenticated baseline receipt digest differs")
    require(isinstance(baseline.components, dict) and set(baseline.components) == {"web", *RETAINED},
            "Exact accepted Web, Core, Engine and ingress image facts required")
    result = {}
    for name, row in baseline.components.items():
        keys = {"registryRef", "imageId", "sourceRevision"}
        if name in inputs.COMPONENTS:
            keys.update({"inputSha256", "inputPolicySha256"})
        if name == "engine":
            keys.update({"contextVersion", "contextSha256"})
        require(isinstance(row, dict) and set(row) == keys, "Exact original image provenance fields required")
        require(_matches(IMAGE_ID, row["imageId"]) and (
            _matches(REVISION, row["sourceRevision"]) or (name == "ingress" and row["sourceRevision"] is None)
        ), "Original immutable image and source identities required")
        reference = row["registryRef"]
        require(isinstance(reference, str) and reference.count("@") == 1, "Immutable original registry reference required")
        repository, digest = reference.split("@")
        require(_matches(IMAGE_ID, digest), "Immutable original registry digest required")
        try:
            validate_repository_prefix(repository)
        except RegistryError as error:
            raise WebReleaseInputError("Invalid original registry repository") from error
        if name in inputs.COMPONENTS:
            require(row["inputSha256"] == receipt["components"][name]["componentInputSha256"]
                    and row["inputPolicySha256"] == receipt["inputPolicySha256"],
                    "Original Core inputs differ from the authenticated accepted assembly")
        if name == "engine":
            require(row["contextVersion"] == ENGINE_CONTEXT_VERSION and _matches(inputs.HASH, row["contextSha256"]),
                    "Original Engine context policy differs")
        result[name] = dict(row)
    return result


def _plain_copy(raw):
    value = inputs.decode(raw)
    require(isinstance(value, dict) and isinstance(value.get(COPY_KEY), str), "Reviewed UI copy key required")
    label = value.pop(COPY_KEY)
    require(0 < len(label) <= 120 and label == label.strip()
            and all(character.isprintable() or character == "\u200c" for character in label)
            and not any(character in label for character in "{}<>"), "Plain reviewed UI copy required")
    return label, inputs.canonical(value)


def _presentation_delta(root, before, after):
    changed = sorted(path for path in before.keys() | after.keys() if before.get(path) != after.get(path))
    require(0 < len(changed) <= 1 + len(COPY_FILES) and set(changed) <= {STYLE_FILE, *COPY_FILES},
            "Source delta exceeds the reviewed presentation-only profile")
    for path in changed:
        before_mode, previous = _blob(root, before, path, MAX_PRESENTATION_BYTES)
        after_mode, current = _blob(root, after, path, MAX_PRESENTATION_BYTES)
        require(before_mode == after_mode == "100644", "Presentation mode or file type changed")
        if path == STYLE_FILE:
            old_css, new_css = previous.decode("utf-8", "strict"), current.decode("utf-8", "strict")
            old_values = [int(match[2]) for match in STYLE_VALUE.finditer(old_css)]
            new_values = [int(match[2]) for match in STYLE_VALUE.finditer(new_css)]
            require(old_values != new_values and all(0 <= value <= MAX_STYLE_PX for value in new_values)
                    and STYLE_VALUE.sub(r"\g<1>VALUE\g<3>", old_css) == STYLE_VALUE.sub(r"\g<1>VALUE\g<3>", new_css),
                    "CSS delta exceeds the reviewed numeric layout declarations")
        else:
            old_label, old_other = _plain_copy(previous)
            new_label, new_other = _plain_copy(current)
            require(old_label != new_label and old_other == new_other, "UI catalog changes exceed the reviewed copy key")
    return changed


def verify_web_source_delta(root: Path, current_receipt: dict, *, expected_revision: str,
                            baseline_revision: str, baseline_receipt: dict) -> dict:
    """Verify source eligibility for an independently assembled Web rehearsal.

    Version one supports the reviewed TopBar numeric layout and table-control copy
    demonstration. Shared dependency manifests, executable UI/SSR, general styles
    and SDK changes require a separately reviewed input policy. This verifies source
    equality only. The caller establishes the baseline's artifact origin and qualification.
    """
    require(_matches(REVISION, expected_revision) and _matches(REVISION, baseline_revision)
            and expected_revision != baseline_revision, "A distinct exact release revision is required")
    historical = inputs.validate_receipt(baseline_receipt)
    _git(root, "merge-base", "--is-ancestor", baseline_revision, expected_revision, allow_empty=True)
    before, after = _tree(root, baseline_revision), _tree(root, expected_revision)
    changed = _presentation_delta(root, before, after)
    _verify_baseline_blobs(root, before, historical)
    inputs.verify_current(root, current_receipt, expected_revision=expected_revision)
    require(current_receipt["context"] == historical["context"]
            and current_receipt["inputPolicySha256"] == historical["inputPolicySha256"],
            "Core build context or discovery policy changed")
    for name in ("worker", "realtime", "migrator"):
        require(current_receipt["components"][name] == historical["components"][name],
                "A retained Core component's exact inputs changed")
    old_web, new_web = historical["components"]["web"], current_receipt["components"]["web"]
    require({key: value for key, value in old_web.items() if key not in {"inputs", "componentInputSha256"}}
            == {key: value for key, value in new_web.items() if key not in {"inputs", "componentInputSha256"}},
            "Web helper graph or discovery metadata changed")
    old_inputs = {row["path"]: row for row in old_web["inputs"]}
    new_inputs = {row["path"]: row for row in new_web["inputs"]}
    require(old_inputs.keys() == new_inputs.keys()
            and {path for path in old_inputs if old_inputs[path] != new_inputs[path]} == set(changed),
            "Web inputs do not match the exact presentation source delta")
    # The complete raw tree delta already proves that every policy and Engine
    # path (including modes and membership) is the same at both revisions.
    policy = _source_policy(root, after)
    require(context_record(root / ENGINE_ROOT)["sha256"] == policy["engineContextSha256"],
            "Current Engine checkout differs from the verified context")
    # Recheck current raw files/HEAD after source-policy reads. The producer must
    # also recheck around building/qualifying the admitted Web image.
    inputs.verify_source_revision(root, current_receipt, expected_revision)
    return {
        "schemaVersion": 1,
        "kind": "warpdrive-web-source-delta",
        "profile": RUNTIME_PROFILE,
        "presentationPolicyVersion": 1,
        "platform": current_receipt["context"]["platform"],
        "releaseRevision": expected_revision,
        "baselineRevision": baseline_revision,
        "runtimePolicySha256": policy["runtimePolicySha256"],
        "engineContextVersion": policy["engineContextVersion"],
        "engineContextSha256": policy["engineContextSha256"],
        "engineContextTreeSha256": policy["engineContextTreeSha256"],
        "baselineCoreInputReceiptSha256": inputs.content_hash(historical),
        "currentCoreInputReceiptSha256": inputs.content_hash(current_receipt),
        "currentWebInputSha256": new_web["componentInputSha256"],
        "inputPolicySha256": current_receipt["inputPolicySha256"],
        "changedPresentationPaths": changed,
        "buildComponents": ["web"],
        "deploymentAuthorized": False,
    }


def admit_web_release(root: Path, current_receipt: dict, *, expected_revision: str,
                      baseline: AuthenticatedBaseline) -> dict:
    """Bind verified source eligibility to independently authenticated image facts."""
    original = _baseline_components(baseline)
    source = verify_web_source_delta(
        root, current_receipt, expected_revision=expected_revision,
        baseline_revision=baseline.release_revision, baseline_receipt=baseline.core_input_receipt,
    )
    require(source["baselineCoreInputReceiptSha256"] == baseline.core_input_receipt_sha256
            and source["runtimePolicySha256"] == baseline.runtime_policy_sha256
            and source["engineContextSha256"] == original["engine"]["contextSha256"],
            "Accepted receipt, Engine context or backend/ingress source policy differs")
    source.pop("baselineRevision")
    source.pop("baselineCoreInputReceiptSha256")
    return {
        **source,
        "kind": "warpdrive-web-release-input-admission",
        "acceptedReleaseRevision": baseline.release_revision,
        "acceptedAuthoritySha256": baseline.authority_sha256,
        "acceptedRuntimeConfigSha256": baseline.runtime_config_sha256,
        "acceptedCoreInputReceiptSha256": baseline.core_input_receipt_sha256,
        "acceptedWeb": original["web"],
        "retainedComponents": {name: original[name] for name in RETAINED},
    }
