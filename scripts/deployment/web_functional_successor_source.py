"""Prove the exact first retained-backend CRM Switch source delta.

Artifact custody authenticates the live Web revision, protected tooling anchor,
and original backend receipt before this verifier is called.
"""

from pathlib import Path

import component_inputs as inputs
from web_build_context import _blob_id
from web_extension_inputs import file_bytes
from web_release_build import checkout
from web_release_inputs import REVISION, _blob, _git, _source_policy, _tree
from web_retained_backend_inputs import RETAINED
from web_sdk_full_receipt import IMPORT_POLICY, IMPORT_SCANNER, discover_web_sdk_full_receipt


PROFILE_PATH = "scripts/deployment/web-functional-switch-profile.json"
SWITCH = "src/components/ui/Switch.tsx"
KEYBOARD_HELP = "src/components/shell/KeyboardHelp.tsx"
SWITCH_ENTRY = "@ui-sdk/react/switch"
SWITCH_EXPORTS = ["Switch", "SwitchThumb"]
VERIFIER = "scripts/deployment/web_functional_successor_source.py"
VERIFY_FILES = {VERIFIER, "scripts/deployment/web_sdk_full_receipt.py", "scripts/deployment/web_sdk_full_inputs.mjs",
                "scripts/deployment/web_presentation_policy.mjs", IMPORT_POLICY, IMPORT_SCANNER}
MAX_PROFILE_BYTES = 64 * 1024
MAX_TOOLING_CHANGES = 128


def _matches(pattern, value):
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def _changed(before, after):
    return sorted(path for path in before.keys() | after.keys() if before.get(path) != after.get(path))


def _reviewed_tooling_path(path):
    # A checksum cannot turn application or runtime code into release tooling.
    return path.startswith(("scripts/deployment/", ".github/workflows/", "docs/delivery/")) or path in {
        "eslint.config.mjs", "ciWorkflow.test.ts",
    }


def _blob_pin(tree, path):
    record = tree.get(path)
    if record is None:
        return None
    inputs.require(record[:2] == ("100644", "blob"), "Changed paths must be nonexecutable regular source")
    return record[2]


def _profile(root, active, tooling, expected_sha):
    mode, raw = _blob(root, tooling, PROFILE_PATH, MAX_PROFILE_BYTES)
    profile = inputs.decode(raw)
    inputs.require(mode == "100644" and type(profile) is dict
                   and set(profile) == {"schemaVersion", "activeWebRevision", "toolingChanges", "carriedWebChanges", "switch"}
                   and type(profile["schemaVersion"]) is int and profile["schemaVersion"] == 2
                   and profile["activeWebRevision"] == active and inputs.content_hash(profile) == expected_sha,
                   "Exact protected Switch successor profile required")
    return profile


def _tooling_delta(active, tooling, profile):
    declared = profile["toolingChanges"]
    carried = profile["carriedWebChanges"]
    changes = [path for path in _changed(active, tooling) if path != PROFILE_PATH]
    inputs.require(type(declared) is list and type(carried) is list
                   and len(declared) + len(carried) == len(changes) <= MAX_TOOLING_CHANGES,
                   "Every active-to-tooling change needs an exact profile pin")
    by_class = {"tooling": [], "web": []}
    for path in changes:
        is_tooling = _reviewed_tooling_path(path)
        inputs.require(is_tooling or (path.startswith("src/") and path not in {SWITCH, KEYBOARD_HELP}),
                       "Active-to-tooling change entered an unreviewed runtime boundary")
        by_class["tooling" if is_tooling else "web"].append({
            "path": path, "beforeBlob": _blob_pin(active, path), "afterBlob": _blob_pin(tooling, path),
        })
    inputs.require(declared == by_class["tooling"] and carried == by_class["web"],
                   "Active-to-tooling change differs from its reviewed blob pins")
    return declared, carried


def _switch_delta(active, tooling, candidate, profile):
    inputs.require(_changed(tooling, candidate) == [SWITCH], "Candidate must change only the canonical Switch source")
    before, after = _blob_pin(tooling, SWITCH), _blob_pin(candidate, SWITCH)
    expected = {"path": SWITCH, "beforeBlob": before, "afterBlob": after}
    inputs.require(before is not None and after is not None and _blob_pin(active, SWITCH) == before
                   and profile["switch"] == expected, "Exact reviewed Switch blob pair required")
    pilot = _blob_pin(active, KEYBOARD_HELP)
    inputs.require(pilot is not None and _blob_pin(candidate, KEYBOARD_HELP) == pilot,
                   "Previously installed keyboard SDK source must be retained")
    return expected


def _backend(receipt, expected_sha):
    inputs.validate_receipt(receipt)
    inputs.require(_matches(inputs.HASH, expected_sha) and inputs.content_hash(receipt) == expected_sha,
                   "Original backend receipt differs from its admitted digest")
    return {**receipt, "components": {name: receipt["components"][name] for name in RETAINED}}


def _verify_working_sources(root, tooling, candidate):
    for path in sorted(VERIFY_FILES | {PROFILE_PATH}):
        raw = file_bytes(root / path, MAX_PROFILE_BYTES)
        inputs.require(candidate.get(path) == tooling.get(path) == ("100644", "blob", _blob_id(raw)),
                       "Successor verifier or profile differs from protected tooling bytes")
    switch = file_bytes(root / SWITCH, MAX_PROFILE_BYTES)
    inputs.require(candidate[SWITCH] == ("100644", "blob", _blob_id(switch)),
                   "Working Switch source differs from the reviewed Git blob")


def _discover_candidate(root, revision, original, carried):
    # The original receipt's scanner and backend input bytes must be proven before
    # executing fresh discovery. The SDK scanner also rejects helper reachability.
    inputs.verify_source_revision(root, original, revision)
    context = original["context"]
    fresh = discover_web_sdk_full_receipt(root, expected_revision=revision, base_image=context["baseImage"],
                                          platform=context["platform"], build_args=context["buildArgs"])
    inputs.require(inputs.canonical(fresh["backendInputs"]) == inputs.canonical(original),
                   "Fresh backend input inventory differs from the original retained backend")
    inputs.require(fresh["schemaVersion"] == 2, "Switch successor requires v2 Web SDK binding evidence")
    web = fresh["web"]
    protected = set(web["helperGraphInputs"]) | {
        row["path"] for component in original["components"].values() for row in component["inputs"]
    }
    inputs.require(not any(row["path"] in protected for row in carried),
                   "Carried Web change entered a protected executable input")
    imports = web["sdkImports"]
    bindings = web["sdkBindings"].get(SWITCH, [])
    inputs.require(imports == {KEYBOARD_HELP: ["@ui-sdk/react/dialog"], SWITCH: [SWITCH_ENTRY]}
                   and sorted(row["exported"] for row in bindings) == SWITCH_EXPORTS,
                   "Expected only the retained keyboard pilot and reviewed Switch SDK bindings")
    return web


def verify_web_functional_successor_source(root, *, active_revision, tooling_revision, candidate_revision,
                                           profile_sha256, original_backend_receipt, original_backend_sha256):
    """Read exact source and retained backend evidence. No build or rollout authority."""
    root = Path(root)
    selected = (active_revision, tooling_revision, candidate_revision)
    inputs.require(all(_matches(REVISION, revision) for revision in selected) and len(set(selected)) == 3
                   and _matches(inputs.HASH, profile_sha256), "Distinct exact Web and tooling revisions required")
    checkout(root, candidate_revision)
    _git(root, "merge-base", "--is-ancestor", active_revision, tooling_revision, allow_empty=True)
    _git(root, "merge-base", "--is-ancestor", tooling_revision, candidate_revision, allow_empty=True)
    active, tooling, candidate = (_tree(root, revision) for revision in selected)
    profile = _profile(root, active_revision, tooling, profile_sha256)
    tooling_changes, carried = _tooling_delta(active, tooling, profile)
    switch = _switch_delta(active, tooling, candidate, profile)
    source = _source_policy(root, active)
    inputs.require(source == _source_policy(root, candidate), "Engine or ingress source policy changed")
    original = _backend(original_backend_receipt, original_backend_sha256)
    _verify_working_sources(root, tooling, candidate)
    web = _discover_candidate(root, candidate_revision, original, carried)
    checkout(root, candidate_revision)
    _verify_working_sources(root, tooling, candidate)
    return {
        "schemaVersion": 2, "kind": "warpdrive-web-functional-successor-source", "activeWebRevision": active_revision,
        "toolingRevision": tooling_revision, "candidateRevision": candidate_revision, "profileSha256": profile_sha256,
        "toolingChanges": tooling_changes, "carriedWebChanges": carried, "changed": [switch],
        "runtimePolicySha256": source["runtimePolicySha256"],
        "engineContextTreeSha256": source["engineContextTreeSha256"], "originalBackendReceiptSha256": original_backend_sha256,
        "retainedComponentInputSha256": {name: original["components"][name]["componentInputSha256"] for name in RETAINED},
        "webInputSha256": web["inputSha256"], "importPolicySha256": web["importPolicySha256"],
        "sdkBindings": web["sdkBindings"], "deploymentAuthorized": False,
    }
