"""Validate SDK Web inputs alongside unchanged full-release backend inputs."""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import re
import sys

import component_inputs as inputs


BACKEND = ("worker", "realtime", "migrator")
KIND = "warpdrive-web-sdk-full-inputs"
PROFILE = "warpdrive-web-ui-sdk-beta1-hoisted-v1"
RECIPE = "deploy/images/Web.Dockerfile"
BASE_IMAGE = "oven/bun@sha256:3f23864d3e8c923975c61971cabe67ee3d5a728f1e25a559256b95af719a3478"
SDK_IMPORTS = {"@ui-sdk/react/menu", "@ui-sdk/react/dialog", "@ui-sdk/react/drawer"}
REVISION = re.compile(r"[a-f0-9]{40}\Z")
SCAN = "scripts/deployment/web_sdk_full_inputs.mjs"
SCANNER_FILES = (SCAN, "scripts/deployment/web_presentation_policy.mjs", *sorted(inputs.POLICY_SOURCES))
DISCOVER = """
const { generateWebSdkFullInputs } = await import('./scripts/deployment/web_sdk_full_inputs.mjs');
const [, revision, baseImage, platform, APP_VERSION, NEXT_PUBLIC_WS_URL] = process.argv.slice(1);
const receipt = await generateWebSdkFullInputs({
  root: process.cwd(), revision, baseImage, platform, buildArgs: {APP_VERSION, NEXT_PUBLIC_WS_URL},
});
process.stdout.write(JSON.stringify(receipt));
"""


def _hash(value):
    return isinstance(value, str) and inputs.HASH.fullmatch(value) is not None


def _web_policy(web):
    # The Web guard inherits the reviewed backend resolver policy, but the
    # isolated recipe and two sidecar source blobs are specific to Web.
    return {key: web[key] for key in ("profile", "pinnedInputs", "helperEntries")}


def validate_web_sdk_full_receipt(value, *, expected_revision):
    """Validate an offline receipt; recomputed hashes do not prove discovery."""
    from web_extension_inputs import REVIEWED_WEB_INPUTS

    inputs.require(isinstance(expected_revision, str) and REVISION.fullmatch(expected_revision),
                   "Exact SDK full-release source revision required")
    inputs.require(type(value) is dict and set(value) == {
        "schemaVersion", "kind", "sourceRevision", "backendInputs", "web", "deploymentAuthorized",
    } and type(value["schemaVersion"]) is int and value["schemaVersion"] == 1 and value["kind"] == KIND
        and value["sourceRevision"] == expected_revision and value["deploymentAuthorized"] is False,
        "Exact source-bound SDK full input receipt required")
    backend = inputs.validate_receipt(value["backendInputs"], components=BACKEND)
    web = value["web"]
    inputs.require(type(web) is dict and set(web) == {
        "profile", "context", "gitInventorySha256", "pinnedInputs", "helperEntries", "helperGraphInputs",
        "sdkImports", "staticWebInputCount", "inputSha256",
    } and web["profile"] == PROFILE and web["context"] == backend["context"]
        and web["context"]["baseImage"] == BASE_IMAGE and _hash(web["gitInventorySha256"]),
        "SDK Web context, platform or isolated recipe profile differs")

    pinned = web["pinnedInputs"]
    inputs.require(type(pinned) is dict and set(pinned) == set(REVIEWED_WEB_INPUTS),
                   "Complete reviewed SDK Web recipe and sidecar pins required")
    for path, (blob, digest) in REVIEWED_WEB_INPUTS.items():
        record = pinned[path]
        inputs.require(type(record) is dict and set(record) == {"gitBlob", "sha256", "bytes"}
                       and record["gitBlob"] == blob and record["sha256"] == digest
                       and type(record["bytes"]) is int and 0 < record["bytes"] <= 64 * 1024,
                       "Reviewed SDK Web recipe or sidecar input differs")

    graph = set(inputs._paths(web["helperGraphInputs"], inputs.MAX_GRAPH_INPUTS))
    entries = web["helperEntries"]
    inputs.require(type(entries) is list and 0 < len(entries) <= 16
                   and entries == backend["policy"]["entries"]["web"], "Web helper entries differ from legacy policy")
    for entry in entries:
        inputs.require(type(entry) is dict and set(entry) == {"in", "out"}
                       and inputs.safe_path(entry["in"]) in graph
                       and inputs.safe_path(entry["out"]).startswith("dist/"), "Web helper graph is incomplete")
    backend_graph = set().union(*(backend["components"][name]["graphInputs"] for name in BACKEND))
    imports = web["sdkImports"]
    count = web["staticWebInputCount"]
    inputs.require(type(count) is int and len(entries) <= count <= inputs.MAX_GRAPH_INPUTS
                   and type(imports) is dict and len(imports) <= count, "Bounded SDK Web reachability required")
    for path, specifiers in imports.items():
        inputs.require(inputs.safe_path(path) not in graph | backend_graph and type(specifiers) is list
                       and 0 < len(specifiers) <= len(SDK_IMPORTS)
                       and all(isinstance(name, str) and name in SDK_IMPORTS for name in specifiers)
                       and specifiers == sorted(set(specifiers)), "SDK import exceeds the isolated Web profile")
    inputs.require(_hash(web["inputSha256"])
                   and web["inputSha256"] == inputs.content_hash({key: child for key, child in web.items() if key != "inputSha256"}),
                   "SDK Web input digest differs")
    inputs.require(len(inputs.canonical(value)) < inputs.MAX_JSON_BYTES, "SDK full input receipt exceeds byte budget")
    return value


def _check_git_inputs(root, expected_revision, *, value=None, web_context=None):
    from web_build_context import _blob_id, _context_tree, verify_context
    from web_extension_inputs import file_bytes
    from web_release_inputs import _git

    tree = _context_tree(root, expected_revision)
    for path in SCANNER_FILES:
        source = file_bytes(root / path, inputs.MAX_FILE_BYTES)
        inputs.require(tree.get(path) == ("100644", "blob", _blob_id(source)),
                       "Executable SDK source scanner differs from selected Git bytes")
    if value is None:
        return
    web = value["web"]
    git_inventory = inputs.content_hash({path: list(row) for path, row in tree.items()})
    inputs.require(git_inventory == web["gitInventorySha256"], "SDK Web receipt differs from exact Git context")
    inputs.require((set(web["helperGraphInputs"]) | web["sdkImports"].keys()) <= tree.keys(),
                   "SDK Web receipt refers to source outside the exact Git context")
    for path, record in web["pinnedInputs"].items():
        inputs.require(tree.get(path) == ("100644", "blob", record["gitBlob"])
                       and _git(root, "cat-file", "-s", record["gitBlob"]) == f"{record['bytes']}\n".encode(),
                       "SDK Web recipe or sidecar does not match exact Git context")
    if web_context is not None:
        verified = verify_context(root, expected_revision, web_context)
        inputs.require(verified["gitInventorySha256"] == git_inventory
                       and verified["dockerfile"] == str(web_context / RECIPE),
                       "Staged SDK Web build context or selected recipe differs")


def _discover_web_sdk_full_receipt(root, expected_revision, context):
    args = context["buildArgs"]
    arguments = ["node", "--input-type=module", "-e", DISCOVER, "--", ".", expected_revision,
                 context["baseImage"], context["platform"], args["APP_VERSION"], args["NEXT_PUBLIC_WS_URL"]]
    environment = {key: os.environ[key] for key in ("PATH", "HOME", "TMPDIR") if key in os.environ}
    value = inputs.decode(inputs._discover(arguments, root, environment))
    return validate_web_sdk_full_receipt(value, expected_revision=expected_revision)


def discover_web_sdk_full_receipt(root, *, expected_revision, base_image, platform, build_args):
    """Produce source evidence from the exact selected checkout using the SDK scanner."""
    root = Path(root)
    inputs.require(isinstance(expected_revision, str) and REVISION.fullmatch(expected_revision),
                   "Exact SDK full-release source revision required")
    context = {"baseImage": base_image, "platform": platform, "buildArgs": build_args}
    inputs._context(context)
    _check_git_inputs(root, expected_revision)
    value = _discover_web_sdk_full_receipt(root, expected_revision, context)
    inputs.require(value["web"]["context"] == context, "SDK discovery returned a different build context")
    inputs.verify_source_revision(root, value["backendInputs"], expected_revision)
    _check_git_inputs(root, expected_revision, value=value)
    return value


def verify_current_web_sdk_full_receipt(root, value, *, expected_revision, web_context=None):
    """Rerun input discovery and optionally bracket the actual staged Web context."""
    value = validate_web_sdk_full_receipt(value, expected_revision=expected_revision)
    root = Path(root)
    web_context = None if web_context is None else Path(web_context)
    backend = value["backendInputs"]
    context = backend["context"]
    _check_git_inputs(root, expected_revision, value=value, web_context=web_context)
    inputs.verify_source_revision(root, backend, expected_revision)
    fresh = _discover_web_sdk_full_receipt(root, expected_revision, context)
    inputs.require(inputs.canonical(fresh) == inputs.canonical(value),
                   "Fresh SDK Web or backend input discovery differs from the receipt")
    inputs.verify_source_revision(root, backend, expected_revision)
    _check_git_inputs(root, expected_revision, value=value, web_context=web_context)
    return value


def candidate_input_facts(value, *, expected_revision):
    """Project the exact per-image input fingerprints for an all-new assembly."""
    value = validate_web_sdk_full_receipt(value, expected_revision=expected_revision)
    backend = value["backendInputs"]
    web = value["web"]
    backend_policy = backend["inputPolicySha256"]
    web_policy = inputs.content_hash({**_web_policy(web), "backendInputPolicySha256": backend_policy})
    components = {name: {"sourceRevision": expected_revision,
                         "inputSha256": backend["components"][name]["componentInputSha256"],
                         "inputPolicySha256": backend_policy} for name in BACKEND}
    components["web"] = {"sourceRevision": expected_revision, "inputSha256": web["inputSha256"],
                         "inputPolicySha256": web_policy}
    return {"components": components, "inputProvenance": {
        "state": "current-source-sdk-web-inputs-bound", "receiptSha256": inputs.content_hash(value),
        "backendInputPolicySha256": backend_policy, "webInputPolicySha256": web_policy, "webProfile": PROFILE,
    }}


def create_web_sdk_full_candidate(revision, report, report_digest, inspections, *, input_receipt):
    """Apply the full-image smoke admission and attach SDK-specific input facts."""
    from candidate import create_candidate, require

    result = create_candidate(revision, report, report_digest, inspections)
    facts = candidate_input_facts(input_receipt, expected_revision=revision)
    web = inspections["web"]["Config"]
    environment = web.get("Env")
    require(type(environment) is list and all(type(row) is str for row in environment),
            "SDK Web image environment inspection required")
    expected = {"APP_COMMIT": revision, "NEXT_DEPLOYMENT_ID": f"wd-{revision}",
                "APP_VERSION": input_receipt["web"]["context"]["buildArgs"]["APP_VERSION"]}
    for name, value in expected.items():
        require([row for row in environment if row.split("=", 1)[0] == name] == [f"{name}={value}"],
                f"SDK Web image {name} differs")
    require(web.get("Cmd") == ["bun", "--bun", "next", "start"] and web.get("WorkingDir") == "/app"
            and web.get("Labels", {}).get("org.opencontainers.image.title") == "Warpdrive Web",
            "SDK Web image runtime profile differs")
    for name, component in result["components"].items():
        component.update(facts["components"][name])
    result.update(schemaVersion=3, releaseRevision=revision, inputProvenance=facts["inputProvenance"])
    result["pendingGates"].append("independently-qualified-component-reuse")
    return result


def prepare_web_sdk_full_release(root, revision, web_context, output):
    """Prepare the exact tracked-only context used for the official SDK Web build."""
    from web_build_context import prepare_context
    from web_release_build import private_destination, write_metadata

    private_destination(output, root)
    value = discover_web_sdk_full_receipt(
        root, expected_revision=revision, base_image=BASE_IMAGE, platform="linux/amd64",
        build_args={"APP_VERSION": "", "NEXT_PUBLIC_WS_URL": "same-origin"},
    )
    context = prepare_context(root, revision, web_context)
    inputs.require(context["gitInventorySha256"] == value["web"]["gitInventorySha256"]
                   and context["dockerfile"] == str(web_context / RECIPE),
                   "Prepared SDK Web context differs from input discovery")
    write_metadata(output, value)
    return value


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    subcommands = parser.add_subparsers(dest="command", required=True)
    prepare = subcommands.add_parser("prepare")
    for key in ("root", "context", "output"):
        prepare.add_argument(f"--{key}", required=True, type=Path)
    prepare.add_argument("--revision", required=True)
    args = parser.parse_args(argv)
    try:
        prepare_web_sdk_full_release(args.root, args.revision, args.context, args.output)
    except (OSError, ValueError, TypeError, KeyError, RuntimeError) as error:
        print(f"SDK Web input preparation held ({type(error).__name__}): {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
