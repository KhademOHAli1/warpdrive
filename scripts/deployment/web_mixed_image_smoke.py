#!/usr/bin/env python3
"""Qualify one Web switch and reversal on an owned native Linux fixture."""
from __future__ import annotations

import argparse
import copy
import hashlib
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import platform
import queue
import re
import secrets
import ssl
import stat
import subprocess
import sys
import tempfile
import uuid
from urllib.parse import unquote, urlsplit
from urllib.request import HTTPError, HTTPSHandler, ProxyHandler, Request, build_opener

sys.dont_write_bytecode = True

from bundle import MANIFEST, MAX_METADATA_BYTES, load_bundle, regular_file, sha256
from browser_realtime_smoke import (BrowserProcess, admit_bundle_source, admit_fixture_result, admit_profile,
                                    admit_source, source_runtime_environment)
from image_smoke import COMPONENTS, OWNER_LABEL, ImageSmoke, image_metadata, utc_now, validate_revision
from loopback_forwarder import owned_bridge_forwarder
from registry_smoke import IsolatedDocker, loopback_authority
from web_generation_routes import WebGeneration, compile_web_generation_routes
from web_rollout import rollout_web
from web_switch import DefiniteRejected, HASH, IMAGE, canonical, content_hash
from web_switch_smoke import (
    ADMIN_HOST, CADDY_TMPFS, GENERATION_HEADER, MAX_HTTP_BYTES, MIB, FixtureHTTP, NoRedirect,
    WebSwitchSmoke, WebSwitchSmokeError, caddy_image, caddy_storage, canonical_environment, changed_fields, fixture_caddyfile,
    memory_budget, require, runtime_config,
)


HEADER = "X-Warpdrive-Fixture-Web-Generation"
ROOT = Path(__file__).resolve().parents[2]
BROWSER_SCRIPT = "scripts/browser-web-rollout.mjs"
SEED_SCRIPT = "scripts/browser-realtime-fixture.mjs"
REPEAT_BROWSER_PROFILE = "warpdrive-web-continuity-v2"
CRM_SWITCH = "crm-switch"
SWITCH_TOOLING = {"scripts/deployment/web_sdk_switch_fixture.mjs", "scripts/browser-workflow-preference-actions.mjs"}
REPEAT_OPTIONS = ("active_web_bundle", "active_web_publication_receipt",
                  "active_web_publication_receipt_sha256", "seed_root", "harness_revision")
SUCCESSOR_OPTIONS = ("successor_web_bundle", "successor_web_publication_receipt",
                     "successor_web_publication_receipt_sha256", "successor_web_revision",
                     "predecessor_lineage_sha256")
FUNCTIONAL_PREDECESSOR_OPTIONS = ("functional_predecessor_composite", "functional_predecessor_composite_sha256")
RETAINED_COMPONENTS = ("worker", "realtime", "migrator")
BROWSER_PHASES = {
    "initial-ready": {"oldStatic": True, "nativeLogin": True, "draftReady": True, "subscribed": True},
    "pre-switch-ready": {"oldSocketActive": True},
    "complete": {"freshTicket": True, "resubscribed": True, "persistentDraft": True, "oldAction": True, "actionPosts": 1},
}
SDK_KEYBOARD_HELP = dict.fromkeys(
    ("openedByKeyboard", "escapeClosed", "focusRestored", "closeButtonWorked", "sameDocument"), True)
SDK_SWITCH = {"schemaVersion": 1, "activatedByKeyboard": True, "savedByCandidate": True,
              "persistedAfterReload": True, "actionPosts": 1}
BROWSER_FAILURES = {"profile", "browser-start", "native-login-and-draft", "pre-switch-socket",
                    "waiting-for-switch", "persistent-reconnect", "old-tab-server-action",
                    "current-rendered-presentation", "current-keyboard-help", "current-crm-switch", "browser-close"}
HEALTH = "/api/health"
IDENTITY = "/api/runtime/web-identity"
LOGIN = "/login"
STATIC = "/_next/static/"
BUILD_ENV = {"APP_COMMIT", "APP_VERSION", "NEXT_DEPLOYMENT_ID"}
REVISION_LABEL = "org.opencontainers.image.revision"
MAX_PAGE = 1024 * 1024
MAX_ASSET = 4 * 1024 ** 2
LIMITS = {"postgres": 512, "worker": 1024, "realtime": 768, "web-a": 1536, "web-b": 1536,
          "caddy": 256}
LIMITATIONS = [
    "Owned staging fixture with a fresh database and retained Core images.",
    "Explicit reverse rollout through the same controller and running Web slots.",
    "Automatic restoration after an owned candidate stops following an acknowledged route switch.",
    "Sampled CSS and JavaScript byte readback, public identity, and database health.",
    "Production installation, populated upgrades, Engine, and external providers remain outside this evidence.",
]
REPEAT_LIMITATIONS = [*LIMITATIONS, "Two Web slots qualify the authenticated active and candidate pair; "
                      "the preceding retained Web slot is outside this browser fixture."]


def repeat_mode(args):
    selected = [getattr(args, name, None) is not None for name in REPEAT_OPTIONS]
    if not any(selected):
        return False
    require(all(selected) and args.browser, "Repeat Web qualification requires every repeat input and the native browser")
    require(HASH.fullmatch(args.active_web_publication_receipt_sha256)
            and validate_revision(args.harness_revision) == args.harness_revision
            and all(path.is_absolute() and path == path.resolve(strict=True)
                    for path in (args.active_web_bundle, args.active_web_publication_receipt, args.seed_root)),
            "Exact canonical repeat Web custody and seed paths required")
    return True


def successor_mode(args):
    selected = [getattr(args, name, None) is not None for name in SUCCESSOR_OPTIONS]
    if not any(selected):
        return False
    require(all(selected) and repeat_mode(args),
            "Successor Web qualification requires complete repeat and successor inputs")
    require(HASH.fullmatch(args.successor_web_publication_receipt_sha256)
            and HASH.fullmatch(args.predecessor_lineage_sha256)
            and validate_revision(args.successor_web_revision) == args.successor_web_revision
            and all(path.is_absolute() and path == path.resolve(strict=True)
                    for path in (args.successor_web_bundle, args.successor_web_publication_receipt)),
            "Exact canonical successor Web custody and predecessor lineage pins required")
    core, previous, active = (args.bundle_dir.resolve(), args.active_web_bundle, args.successor_web_bundle)
    require(len({core, previous, active}) == 3 and all(
                not left.is_relative_to(right) for left in (core, previous, active)
                for right in (core, previous, active) if left != right),
            "Original Core, previous Web and active Web bundles must be separate")
    return True


def functional_successor_mode(args):
    selected = [getattr(args, name, None) is not None for name in FUNCTIONAL_PREDECESSOR_OPTIONS]
    if not any(selected):
        return False
    require(all(selected) and args.browser and not any(getattr(args, name, None) is not None for name in REPEAT_OPTIONS[:3])
            and all(getattr(args, name, None) is not None for name in (*SUCCESSOR_OPTIONS, *REPEAT_OPTIONS[3:])),
            "Functional history requires an independent predecessor composite, active archive and native browser")
    require(all(HASH.fullmatch(getattr(args, name)) for name in (
                "functional_predecessor_composite_sha256", "successor_web_publication_receipt_sha256", "predecessor_lineage_sha256"))
            and all(validate_revision(getattr(args, name)) == getattr(args, name) for name in (
                "successor_web_revision", "harness_revision")),
            "Exact functional history digests and sources required")
    paths = (args.bundle_dir, args.successor_web_bundle, args.successor_web_publication_receipt,
             args.functional_predecessor_composite, args.seed_root)
    require(all(path.is_absolute() and path == path.resolve(strict=True) for path in paths)
            and all(not left.is_relative_to(right) and not right.is_relative_to(left)
                    for index, left in enumerate(paths) for right in paths[index + 1:]),
            "Independent canonical functional history paths required")
    return True


def add_functional_predecessor_options(parser):
    parser.add_argument("--functional-predecessor-composite", type=Path)
    parser.add_argument("--functional-predecessor-composite-sha256")


def repeat_baseline(args, backend, *, candidate_revision=None):
    # Avoid a module cycle: composite custody validates the earlier Web bundle
    # using the V1 mixed report reader.
    from web_composite_baseline import verify_web_composite_baseline
    from web_release_inputs import _git, _tree, _verify_baseline_blobs

    with os.fdopen(os.open(args.active_web_publication_receipt, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), "rb") as stream:
        info = os.fstat(stream.fileno())
        require(stat.S_ISREG(info.st_mode) and 0 < info.st_size <= MAX_METADATA_BYTES,
                "Bounded historical Web publication receipt required")
        raw = stream.read(MAX_METADATA_BYTES + 1)
        require(len(raw) == info.st_size and os.path.samestat(info, args.active_web_publication_receipt.lstat()),
                "Historical Web publication receipt changed while reading")
    composite = verify_web_composite_baseline(
        web_receipt=raw, expected_web_receipt_sha256=args.active_web_publication_receipt_sha256,
        web_bundle_dir=args.active_web_bundle, backend_bundle_dir=args.bundle_dir.resolve(),
        expected_backend_manifest_sha256=args.baseline_manifest_sha256,
    )
    active, retained = composite["web"], composite["backend"]
    require(retained["sourceRevision"] == args.baseline_revision
            and retained["origin"] == backend["origin"] and retained["provenance"] == backend["provenance"]
            and all(value == backend["candidate"]["components"][name] for name, value in retained["components"].items()),
            "Composite Web baseline differs from the retained Core bundle")
    before, after = active["sourceRevision"], candidate_revision or args.new_web_revision
    require(len({args.baseline_revision, before, after}) == 3
            and active["image"]["imageId"] != args.new_web_image_id,
            "Repeat qualification needs distinct Core, active Web and candidate sources")
    _git(args.seed_root, "merge-base", "--is-ancestor", args.baseline_revision, before, allow_empty=True)
    _git(args.seed_root, "merge-base", "--is-ancestor", before, after, allow_empty=True)
    _verify_baseline_blobs(args.seed_root, _tree(args.seed_root, before), active["inputReceipt"])
    return composite


def successor_baseline(args, backend):
    """Reconstruct active C from its tested bundle and separately sealed A/B pin."""
    # Successor validation reads the v2 mixed report defined by this module.
    from web_candidate import _input_file
    from web_release_inputs import _git, _tree, _verify_baseline_blobs
    from web_repeat_successor import verify_repeat_successor

    predecessor = repeat_baseline(args, backend, candidate_revision=args.successor_web_revision)
    original, previous, active, candidate = (args.baseline_revision, predecessor["web"]["sourceRevision"],
                                             args.successor_web_revision, args.new_web_revision)
    require(len({original, previous, active, candidate}) == 4,
            "Successor qualification requires four distinct source revisions")
    composite = verify_repeat_successor(
        predecessor=predecessor, repeat_bundle_dir=args.successor_web_bundle,
        publication_bytes=_input_file(args.successor_web_publication_receipt),
        expected_publication_sha256=args.successor_web_publication_receipt_sha256,
        expected_revision=active, predecessor_lineage_sha256=args.predecessor_lineage_sha256,
    )
    old_image, new_image = composite["web"]["image"]["imageId"], args.new_web_image_id
    retained = {row["imageId"] for row in backend["candidate"]["components"].values()}
    require(composite["backend"] == predecessor["backend"] and composite["web"]["sourceRevision"] == active
            and composite["web"]["publicationReceiptSha256"] == args.successor_web_publication_receipt_sha256
            and len({old_image, new_image, predecessor["web"]["image"]["imageId"], *retained})
            == 3 + len(COMPONENTS),
            "Successor Web images must be distinct from the admitted predecessor and Core images")
    _git(args.seed_root, "merge-base", "--is-ancestor", active, candidate, allow_empty=True)
    _verify_baseline_blobs(args.seed_root, _tree(args.seed_root, active), composite["web"]["inputReceipt"])
    return composite


def functional_successor_baseline(args, backend):
    """Admit an active functional archive using its pinned earlier public composite."""
    from component_inputs import decode
    from web_candidate import _input_file
    from web_functional_successor import original_backend_projection, verify_functional_successor
    from web_release_inputs import _git

    candidate = backend["candidate"]
    require(candidate["schemaVersion"] == 2 and candidate["revision"] == args.baseline_revision
            and backend["provenance"]["bundleManifestSha256"] == args.baseline_manifest_sha256,
            "Exact original retained Core bundle required")
    original = original_backend_projection(backend)
    predecessor = decode(_input_file(args.functional_predecessor_composite))
    active, current = args.successor_web_revision, args.new_web_revision
    result = verify_functional_successor(predecessor=predecessor,
        expected_predecessor_sha256=args.functional_predecessor_composite_sha256, original_backend=original,
        functional_bundle_dir=args.successor_web_bundle, publication_bytes=_input_file(args.successor_web_publication_receipt),
        expected_publication_sha256=args.successor_web_publication_receipt_sha256, expected_revision=active,
        predecessor_lineage_sha256=args.predecessor_lineage_sha256)
    prior = predecessor["web"]
    require(len({args.baseline_revision, prior["sourceRevision"], active, current}) == 4
            and args.new_web_image_id not in {prior["image"]["imageId"], result["web"]["image"]["imageId"],
                                              *(item["imageId"] for item in candidate["components"].values())},
            "Functional successor sources and images must be distinct")
    _git(args.seed_root, "merge-base", "--is-ancestor", args.baseline_revision, prior["sourceRevision"], allow_empty=True)
    _git(args.seed_root, "merge-base", "--is-ancestor", prior["sourceRevision"], active, allow_empty=True)
    _git(args.seed_root, "merge-base", "--is-ancestor", active, current, allow_empty=True)
    return result


def repeat_assembly(composite, new):
    from component_inputs import content_hash as input_hash

    active, retained = composite["web"], composite["backend"]
    return {
        "activeWebRevision": active["sourceRevision"],
        "activeWebImage": {key: active["image"][key] for key in ("imageId", "sourceRevision", "generation")},
        "activeWebManifestSha256": active["provenance"]["bundleManifestSha256"],
        "activeWebArchiveSha256": active["provenance"]["archiveSha256"],
        "activeWebPublicationReceiptSha256": active["publicationReceiptSha256"],
        "originalBackendRevision": retained["sourceRevision"],
        "originalBackendManifestSha256": retained["provenance"]["bundleManifestSha256"],
        "originalBackendArchiveSha256": retained["provenance"]["archiveSha256"],
        "retainedBackendImages": {name: retained["components"][name]["imageId"] for name in RETAINED_COMPONENTS},
        "newWeb": new, "fixtureBuilds": 0, "compositeSha256": input_hash(composite),
    }


def verify_repeat_harness(root, host, revision, *, sdk_scenario=None):
    """Verify executing toolkit bytes even when Git index flags hide worktree edits."""
    from web_release_inputs import _git, _tree

    require(sdk_scenario is None or sdk_scenario == CRM_SWITCH, "Unreviewed SDK browser scenario")
    admit_source(host, revision)
    tree = _tree(root, revision)
    tooling = ("scripts/deployment", "scripts/delivery", "tools/browser-smoke")
    # The browser package has its own frozen install. Refuse other ignored
    # files here as well, including importable Python bytecode.
    require(not _git(root, "ls-files", "--others", "--", *tooling,
                     ":(exclude)tools/browser-smoke/node_modules/**", allow_empty=True),
            "Untracked repeat browser toolkit source is not admitted")
    paths = {name for name in tree if name.startswith(tuple(directory + "/" for directory in tooling))}
    paths.update((BROWSER_SCRIPT, "package.json"))
    required = {"scripts/deployment/web_mixed_image_smoke.py", "tools/browser-smoke/package.json",
                "tools/browser-smoke/bun.lock", BROWSER_SCRIPT, "package.json"}
    if sdk_scenario == CRM_SWITCH:
        required.update(SWITCH_TOOLING)
        paths.update(SWITCH_TOOLING)
    require(required <= tree.keys(), "Repeat browser toolkit source is incomplete")
    for name in sorted(paths):
        mode, kind, identifier = tree[name]
        require(mode in {"100644", "100755"} and kind == "blob", "Regular repeat browser toolkit source required")
        raw = regular_file(root, name, MAX_METADATA_BYTES).read_bytes()
        prefix = f"blob {len(raw)}\0".encode("ascii")
        require(hashlib.sha1(prefix + raw, usedforsecurity=False).hexdigest() == identifier,
                "Repeat browser toolkit differs from the exact reviewed source")


def build_environment(entries):
    return dict(binding.split("=", 1) for binding in canonical_environment(entries))


def common_web_configuration(row, revision):
    config = runtime_config(row)
    require(isinstance(row.get("Image"), str) and IMAGE.fullmatch(row["Image"])
            and config["Config"].pop("Image", None) == row["Image"],
            "Web container must launch by its independently observed immutable image ID")
    env = build_environment(config["Config"]["Env"])
    require(env.get("APP_COMMIT") == revision and env.get("NEXT_DEPLOYMENT_ID") == "wd-" + revision,
            "Web runtime build stamps differ from its immutable source")
    require(config["Labels"].pop(REVISION_LABEL, None) == revision,
            "Web runtime OCI revision label differs")
    config["Config"]["Env"] = sorted(f"{key}={value}" for key, value in env.items() if key not in BUILD_ENV)
    return config


def owned_resources_absent(docker, resources, owner):
    for kind, fields, extra in (("container", ".Names", ["--all"]), ("network", ".Name", []), ("volume", ".Name", [])):
        matches = {name for resource, name in resources if resource == kind}
        label = f"label={OWNER_LABEL}={owner}"
        queries = [label, *(f"name={name}" for name in sorted(matches))]
        for query in queries:
            response = docker.run([kind, "ls", *extra, "--filter", query,
                                   "--format", "{{json " + fields + "}}"], timeout=5)
            require(len(response.stdout) <= 65536, "Docker cleanup inventory exceeds its bound")
            names = [json.loads(line) for line in response.stdout.splitlines()]
            if any(not isinstance(name, str) or query == label or name in matches for name in names):
                return False
    return True


def read_web_image(docker, image_id, revision):
    require(isinstance(image_id, str) and IMAGE.fullmatch(image_id), "immutable Web image ID required")
    rows = docker.json(["image", "inspect", image_id], timeout=10)
    metadata = image_metadata(rows, revision)
    image, config = rows[0], rows[0]["Config"]
    user = metadata["user"].split(":", 1)[0]
    env = build_environment(config.get("Env"))
    require(metadata["id"] == image_id and image.get("Os") == "linux" and image.get("Architecture") == "amd64"
            and user and not re.fullmatch(r"0+", user) and not config.get("Volumes")
            and config["Labels"].get("org.opencontainers.image.title") == "Warpdrive Web"
            and env.get("APP_COMMIT") == revision and env.get("NEXT_DEPLOYMENT_ID") == "wd-" + revision,
            "final Web image identity, platform, storage or build stamps differ")
    return {"imageId": image_id, "sourceRevision": revision, "generation": env["NEXT_DEPLOYMENT_ID"]}


class LoginAssets(HTMLParser):
    def __init__(self, generation):
        super().__init__()
        self.generation, self.page_generations, self.paths = generation, [], {}

    def handle_starttag(self, tag, attributes):
        if tag == "html":
            self.page_generations += [value for key, value in attributes if key == "data-dpl-id"]
        for key, value in attributes:
            if key not in {"src", "href"} or not value or STATIC not in value:
                continue
            path = urlsplit(value)
            if not path.path.startswith(STATIC) or not path.path.endswith((".js", ".css")):
                continue
            segments = [unquote(segment) for segment in path.path[len(STATIC):].split("/")]
            require(not path.scheme and not path.netloc and not path.fragment
                    and len(value) <= 1024 and value == path.path + "?dpl=" + self.generation
                    and all(re.fullmatch(r"[A-Za-z0-9_.@()+~\[\]-]+", segment) and segment not in {".", ".."}
                            for segment in segments), "invalid or unversioned local Next asset URL")
            self.paths[value] = path.path.rsplit(".", 1)[1]
            require(len(self.paths) <= 512, "login asset inventory exceeds the fixture limit")

    def sample(self):
        self.close()
        require(self.page_generations == [self.generation] and set(self.paths.values()) == {"css", "js"},
                "served login page lacks the qualified Next generation and asset types")
        return {kind: next(path for path, actual_kind in self.paths.items() if actual_kind == kind)
                for kind in ("css", "js")}


class WebHTTP:
    def __init__(self, authority, certificate=None):
        self.origin = ("https://" if certificate else "http://") + loopback_authority(authority)
        handlers = [ProxyHandler({}), NoRedirect()]
        if certificate:
            context = ssl.create_default_context(cafile=certificate)
            context.minimum_version = ssl.TLSVersion.TLSv1_2
            handlers.append(HTTPSHandler(context=context))
        self.opener = build_opener(*handlers)

    def get(self, path, limit=1024):
        require(path in {HEALTH, IDENTITY, LOGIN} or re.fullmatch(
            r"/_next/static/[A-Za-z0-9_.@()+%~/\[\]-]+\?dpl=wd-[a-f0-9]{40}", path),
            "request is outside the fixed fixture Web readback surface")
        request = Request(self.origin + path, headers={"Connection": "close", "Accept-Encoding": "identity"})
        try:
            response = self.opener.open(request, timeout=6)
        except HTTPError as error:
            response = error
        with response:
            body = response.read(limit + 1)
            require(len(body) <= limit and response.headers.get("Content-Encoding") in {None, "identity"},
                    "fixture Web response exceeds its uncompressed byte bound")
            return response.status, response.headers, body


def response_generation(headers, expected):
    require(headers.get_all(HEADER, []) == [expected], "Caddy response generation differs from its compiled upstream")


def observe_identity(client, generation, *, proxied):
    status, headers, body = client.get(IDENTITY)
    if proxied:
        response_generation(headers, generation)
    value = json.loads(body)
    require(status == 200 and headers.get("Cache-Control") == "no-store" and isinstance(value, dict)
            and set(value) == {"contract", "component", "sourceRevision", "version"}
            and value["contract"] == "warpdrive.web.identity.v1" and value["component"] == "web"
            and value["sourceRevision"] == generation[3:] and isinstance(value["version"], str)
            and re.fullmatch(r"[A-Za-z0-9.+-]{1,128}", value["version"]),
            "served Web version/source identity differs")
    return value


def observe_page(client, generation, *, proxied):
    status, headers, body = client.get(LOGIN, MAX_PAGE)
    if proxied:
        response_generation(headers, generation)
    require(status == 200, "qualified Web login page did not render")
    inventory = LoginAssets(generation)
    inventory.feed(body.decode("utf-8"))
    return inventory.sample(), len(inventory.paths)


def observe_asset(client, generation, kind, path, *, proxied):
    status, headers, body = client.get(path, MAX_ASSET)
    if proxied:
        response_generation(headers, generation)
    types = {"css": {"text/css"}, "js": {"text/javascript", "application/javascript"}}
    require(status == 200 and body and headers.get_content_type() in types[kind],
            "qualified Next asset was not served")
    return {"path": path, "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}


def generation_configs(adapted, before, after):
    def compile_config(current, previous):
        result = copy.deepcopy(adapted)
        servers = result["apps"]["http"]["servers"]
        require(len(servers) == 1, "one isolated Caddy fixture listener required")
        slots = [(route["handle"], index) for server in servers.values() for route in server["routes"]
                 for index, handler in enumerate(route["handle"])
                 if handler.get("handler") == "reverse_proxy" and handler.get("upstreams") == [{"dial": before.target + ":3000"}]]
        require(len(slots) == 1, "one exact fixture Web fallback required")
        compiled = compile_web_generation_routes(current=current, previous=previous)
        generation_by_dial = {item.target + ":3000": item.deployment_id for item in (before, after)}
        for route in compiled["routes"]:
            for handler in route["handle"]:
                if handler["handler"] == "reverse_proxy":
                    generation = generation_by_dial[handler["upstreams"][0]["dial"]]
                    handler["headers"]["response"] = {"set": {HEADER: [generation]}}
        handlers, index = slots[0]
        handlers[index] = compiled
        require(len(canonical(result)) <= MAX_HTTP_BYTES, "compiled Caddy configuration exceeds its byte bound")
        return result

    return {before.deployment_id: compile_config(before, after), after.deployment_id: compile_config(after, before)}


def _validate_sdk_scenario(sdk_scenario, *, repeat, sdk_keyboard_help):
    require(sdk_scenario is None or (sdk_scenario == CRM_SWITCH and repeat is True and sdk_keyboard_help is True),
            "CRM Switch browser evidence requires the reviewed repeat and keyboard pilot profile")


def browser_message(value, *, repeat=False, sdk_keyboard_help=False, sdk_scenario=None):
    _validate_sdk_scenario(sdk_scenario, repeat=repeat, sdk_keyboard_help=sdk_keyboard_help)
    require(isinstance(value, dict) and isinstance(value.get("phase"), str) and value["phase"] in BROWSER_PHASES,
            "unexpected browser control phase")
    expected = BROWSER_PHASES[value["phase"]]
    if repeat and value["phase"] == "complete":
        expected = {**expected, "freshStampedPage": True}
        if sdk_keyboard_help:
            facts = value.get("sdkKeyboardHelp")
            require(type(facts) is dict and set(facts) == set(SDK_KEYBOARD_HELP)
                    and all(result is True for result in facts.values()),
                    "incomplete SDK keyboard-help browser proof")
            expected["sdkKeyboardHelp"] = SDK_KEYBOARD_HELP
        if sdk_scenario == CRM_SWITCH:
            facts = value.get("sdkSwitch")
            require(type(facts) is dict and set(facts) == set(SDK_SWITCH)
                    and all(type(facts[key]) is type(wanted) and facts[key] == wanted for key, wanted in SDK_SWITCH.items()),
                    "Incomplete CRM Switch browser proof")
            expected["sdkSwitch"] = SDK_SWITCH
    require(set(value) == {"phase", *expected} and all(type(value[key]) is type(wanted) and value[key] == wanted
                                                     for key, wanted in expected.items()), "incomplete browser control proof")
    return value


class RolloutBrowser(BrowserProcess):
    def __init__(self, environment, *, repeat=False, sdk_keyboard_help=False, sdk_scenario=None):
        _validate_sdk_scenario(sdk_scenario, repeat=repeat, sdk_keyboard_help=sdk_keyboard_help)
        self.repeat = repeat
        self.sdk_keyboard_help = sdk_keyboard_help
        self.sdk_scenario = sdk_scenario
        def run(_command, **options):
            return subprocess.Popen(["bun", "--no-env-file", str(ROOT / BROWSER_SCRIPT)], **options)

        super().__init__(environment, runner=run)

    def _read(self, stream, protocol):
        if not protocol:
            super()._read(stream, protocol)
            return
        try:
            while line := stream.readline(4097):
                require(len(line) <= 4096 and line.endswith("\n"), "oversized or incomplete browser control record")
                self.messages.put_nowait(browser_message(json.loads(line), repeat=self.repeat,
                    sdk_keyboard_help=self.sdk_keyboard_help, sdk_scenario=self.sdk_scenario))
        except (ValueError, RuntimeError, queue.Full):
            self.invalid = True

    def send(self, command):
        require(command in {"pre-switch", "switched"}, "unknown browser rollout command")
        self.process.stdin.write(json.dumps({"command": command}) + "\n")
        self.process.stdin.flush()

    def failure_stages(self):
        stages = []
        for line in list(self.errors):
            try:
                value = json.loads(line)
            except (ValueError, RecursionError):
                continue
            if (isinstance(value, dict) and set(value) == {"event", "stage"}
                    and value["event"] == "browser.web-rollout.failed"
                    and isinstance(value["stage"], str) and value["stage"] in BROWSER_FAILURES):
                stages.append(value["stage"])
        return stages


class MixedCaddyTarget:
    """One sole-writer Caddy instance; the two generation configs are immutable."""

    def __init__(self, smoke, slots, documents, qualification):
        self.smoke, self.slots, self.documents, self.qualification = smoke, slots, documents, qualification
        self.patches = []
        self.stop_after_switch = None

    def verify_qualification(self, plan, *, initialize):
        if (plan["qualificationSha256"] != content_hash(self.qualification)
                or plan["targetKey"] != self.smoke.fixture.prefix
                or plan["backendFingerprint"] != self.qualification["backendFingerprint"]
                or any(slot != self.slots.get(slot["route"]["generation"]) for slot in (plan["before"], plan["after"]))):
            return False
        return not initialize or self.inspect(plan)["route"] == plan["before"]["route"]

    def read_route(self):
        config, etag = self.smoke.admin.config()
        for generation, expected in self.documents.items():
            if config == expected:
                return self.slots[generation]["route"], etag
        require(False, "actual Caddy configuration differs from both compiled generations")

    def inspect(self, plan):
        route, _ = self.read_route()
        schema = self.smoke.schema()
        return {"route": route, "beforeRuntime": self.smoke.web_runtime(plan["before"]["runtime"]["name"], schema),
                "afterRuntime": self.smoke.web_runtime(plan["after"]["runtime"]["name"], schema),
                "backendFingerprint": self.smoke.backend_fingerprint()}

    def observe_health(self, slot, *, proxied):
        name = slot["runtime"]["name"]
        generation = slot["route"]["generation"]
        client = self.smoke.traffic if proxied else self.smoke.direct[name]
        observe_identity(client, generation, proxied=proxied)
        status, headers, body = client.get(HEALTH)
        if proxied:
            response_generation(headers, generation)
        healthy = status == 200
        value = json.loads(body)
        require(status in {200, 503} and isinstance(value, dict) and value.get("ok") is healthy,
                "qualified Web database health is unavailable")
        return {"generation": generation, "runtimeId": self.smoke.owned(name)["Id"], "healthy": healthy}

    def compare_and_swap_route(self, expected, desired):
        browser = self.smoke.browser if not self.patches else None
        if browser:
            browser.send("pre-switch")
            self.smoke.browser_pre_switch = browser.wait("pre-switch-ready", timeout=8)
        current, etag = self.read_route()
        if current != expected:
            raise DefiniteRejected("Caddy route changed before this operation issued its PATCH")
        require(desired == self.slots[desired["generation"]]["route"] and len(self.patches) < 4,
                "unexpected or repeated fixture route mutation")
        self.patches.append({"from": expected["generation"], "to": desired["generation"]})
        status, _, _ = self.smoke.admin.request("PATCH", value=self.documents[desired["generation"]], etag=etag)
        if status == 412:
            raise DefiniteRejected("Caddy rejected the original route ETag")
        require(status == 200, "Caddy route mutation has an unresolved outcome")
        if self.stop_after_switch == desired["generation"]:
            self.stop_after_switch = None
            self.smoke.stop_candidate(self.slots[desired["generation"]]["runtime"]["name"])
        if browser:
            browser.send("switched")


class MixedWebSmoke(WebSwitchSmoke):
    def __init__(self, docker, args, private, *, sdk_scenario=None):
        # A caller that authenticated the successor profile may select an extra witness.
        # Standalone CLI arguments, browser profiles and reports do not select it here.
        super().__init__(docker, args.bundle_dir, args.baseline_revision, args.output_dir)
        self.args, self.private = args, private
        self.functional_successor = functional_successor_mode(args)
        self.repeat = self.functional_successor or repeat_mode(args)
        self.successor = self.functional_successor or successor_mode(args)
        self.sdk_keyboard_help = getattr(args, "sdk_keyboard_help", False)
        require(not self.sdk_keyboard_help or self.successor, "SDK keyboard help requires a successor Web fixture")
        require(getattr(args, "sdk_scenario", None) is None, "CRM Switch scenario requires trusted caller admission")
        require(sdk_scenario is None or self.functional_successor, "CRM Switch requires an accepted functional predecessor")
        _validate_sdk_scenario(sdk_scenario, repeat=self.successor, sdk_keyboard_help=self.sdk_keyboard_help)
        self.sdk_scenario = sdk_scenario
        self.seed_root = args.seed_root if self.repeat else ROOT
        self.browser = None
        self.host_environment = {key: os.environ[key] for key in ("PATH", "HOME", "TMPDIR", "PLAYWRIGHT_BROWSERS_PATH") if key in os.environ}
        self.host_environment.update(BUN_OPTIONS="--no-env-file", BUN_RUNTIME_TRANSPILER_CACHE_PATH=str(private / "bun-cache"))
        self.report.update({"kind": "warpdrive-native-mixed-web-smoke", "scope": "owned-native-staging-fixture",
                            "limitations": LIMITATIONS, "deploymentAuthorized": False,
                            "browserContinuityQualified": False})
        if self.repeat:
            self.report.update({"schemaVersion": 2, "kind": "warpdrive-native-repeat-web-smoke",
                                "limitations": REPEAT_LIMITATIONS, "browserProfile": {
                                    "kind": REPEAT_BROWSER_PROFILE, "harnessRevision": args.harness_revision,
                                    "seedRevision": self.revision,
                                    **({"sdkScenario": sdk_scenario} if sdk_scenario else {})}})

    def load(self):
        require(platform.system() == "Linux" and platform.machine() in {"x86_64", "amd64"},
                "native Linux AMD64 host required")
        info = self.docker.run(["info", "--format", "{{.OSType}} {{.Architecture}}"], timeout=10).stdout.strip()
        require(info in {"linux x86_64", "linux amd64"},
                "native Linux AMD64 daemon required")
        manifest = regular_file(self.bundle_dir.resolve(), MANIFEST, MAX_METADATA_BYTES)
        require(sha256(manifest) == self.args.baseline_manifest_sha256, "baseline differs from the pinned manifest")
        loaded = load_bundle(self.bundle_dir, expected_revision=self.revision)
        candidate = loaded["candidate"]
        require(loaded["origin"]["kind"] == "github-actions"
                and (candidate["schemaVersion"] == 2 or not self.repeat and candidate["schemaVersion"] == 3)
                and loaded["provenance"]["bundleManifestSha256"] == self.args.baseline_manifest_sha256,
                "authenticated hosted baseline manifest with exact source inputs required")
        images = {key: candidate["components"][key]["imageId"] for key in COMPONENTS}
        require(self.args.new_web_revision != self.revision and self.args.new_web_image_id not in images.values(),
                "distinct newly built Web source and image required")
        if self.successor:
            return self.load_successor(loaded, images)
        composite = repeat_baseline(self.args, loaded) if self.repeat else None
        if composite is not None:
            self.verify_browser_source(candidate)
            require(composite["web"]["image"]["imageId"] not in images.values(),
                    "Active Web image must differ from all retained original Core images")
        new = read_web_image(self.docker, self.args.new_web_image_id, self.args.new_web_revision)
        self.docker.run(["image", "load", "--input", str(loaded["archivePath"])], timeout=300)
        self.fixture = ImageSmoke(self.docker, images, self.private / "fixture", expected_revision=self.revision)
        self.fixture.inspect_images()
        require(all(self.fixture.report["images"][key]["id"] == value for key, value in images.items()),
                "loaded baseline component IDs differ from the tested candidate")
        require(read_web_image(self.docker, new["imageId"], new["sourceRevision"]) == new,
                "new Web image changed while loading the retained bundle")
        self.old_image = read_web_image(self.docker, images["web"], self.revision)
        self.new_image = new
        self.assembly = {"baselineRevision": self.revision, "baselineOrigin": loaded["origin"],
                         "baselineImages": images, **loaded["provenance"], "newWeb": new, "fixtureBuilds": 0}
        self.retained_images = images
        if composite is not None:
            from web_candidate import ARCHIVE, MAX_ARCHIVE_BYTES

            assembly = repeat_assembly(composite, new)
            active_image = assembly["activeWebImage"]
            archive = regular_file(self.args.active_web_bundle, ARCHIVE, MAX_ARCHIVE_BYTES)
            require(sha256(archive) == assembly["activeWebArchiveSha256"],
                    "Active Web archive differs from the authenticated bytes")
            self.docker.run(["image", "load", "--input", str(archive)], timeout=300)
            require(sha256(archive) == assembly["activeWebArchiveSha256"],
                    "Active Web archive changed during fixture load")
            self.fixture.inspect_images()
            require(all(self.fixture.report["images"][key]["id"] == value for key, value in images.items()),
                    "Active Web load changed retained Core image identities")
            require(read_web_image(self.docker, active_image["imageId"], active_image["sourceRevision"]) == active_image
                    and read_web_image(self.docker, new["imageId"], new["sourceRevision"]) == new,
                    "Active Web or candidate image differs after loading both archives")
            self.old_image = active_image
            self.report["revision"] = assembly["activeWebRevision"]
            self.assembly = assembly
        self.report["images"] = self.assembly
        self.baseline_candidate = candidate
        return self.assembly

    def load_successor(self, loaded, images):
        """Only active C, candidate D and the original backend can enter runtime checks."""
        from web_candidate import ARCHIVE, MAX_ARCHIVE_BYTES

        candidate = loaded["candidate"]
        reconstruct = functional_successor_baseline if self.functional_successor else successor_baseline
        composite = reconstruct(self.args, loaded)
        self.verify_browser_source(candidate)
        new = read_web_image(self.docker, self.args.new_web_image_id, self.args.new_web_revision)
        assembly = repeat_assembly(composite, new)
        active = assembly["activeWebImage"]
        archive = regular_file(self.args.successor_web_bundle, ARCHIVE, MAX_ARCHIVE_BYTES)
        require(sha256(archive) == assembly["activeWebArchiveSha256"],
                "Successor Web archive differs from the authenticated bytes")
        # The exact original Core archive also contains the unused A Web image.
        # No A or B Web image is selected for inspection, startup or routing.
        require(sha256(loaded["archivePath"]) == assembly["originalBackendArchiveSha256"],
                "Original Core archive differs from the authenticated bytes")
        self.docker.run(["image", "load", "--input", str(loaded["archivePath"])], timeout=300)
        self.docker.run(["image", "load", "--input", str(archive)], timeout=300)
        require(sha256(archive) == assembly["activeWebArchiveSha256"],
                "Successor Web archive changed during fixture load")
        require(sha256(loaded["archivePath"]) == assembly["originalBackendArchiveSha256"],
                "Original Core archive changed during fixture load")
        self.fixture = ImageSmoke(self.docker, images, self.private / "fixture", expected_revision=self.revision)
        for name, identifier in assembly["retainedBackendImages"].items():
            rows = self.docker.json(["image", "inspect", identifier], timeout=10)
            metadata = image_metadata(rows, self.revision)
            require(metadata["id"] == identifier and rows[0].get("Os") == "linux"
                    and rows[0].get("Architecture") == "amd64"
                    and metadata["user"] == candidate["components"][name]["runtimeUser"],
                    "Loaded retained backend image differs from the tested candidate")
            self.fixture.report["images"][name] = metadata
        require(read_web_image(self.docker, active["imageId"], active["sourceRevision"]) == active
                and read_web_image(self.docker, new["imageId"], new["sourceRevision"]) == new,
                "Successor active or candidate image differs after loading retained archives")
        self.old_image, self.new_image = active, new
        self.retained_images = assembly["retainedBackendImages"]
        self.report["revision"] = assembly["activeWebRevision"]
        self.report["images"] = self.assembly = assembly
        self.baseline_candidate = candidate
        return assembly

    def host(self, arguments, *, environment=None, timeout=30, binary=False, root=ROOT):
        result = subprocess.run(arguments, cwd=root, env=environment or self.host_environment, capture_output=True,
                                text=not binary, timeout=timeout, check=False)
        require(result.returncode == 0 and len(result.stdout) <= 65536, "bounded host fixture command failed")
        return result.stdout

    def setup_runtimes(self):
        with Path("/proc/meminfo").open(encoding="ascii") as source:
            admission = memory_budget(source.read(65537))
        # Admit this fixture's actual concurrent set. One-shot migrators and Caddy
        # adaptation finish before Web/Caddy traffic and fit below the same peak.
        limit = sum(LIMITS.values()) * MIB
        require(admission["availableBytes"] >= limit + MIB * 1024, "insufficient isolated fixture memory")
        self.fixture.output_dir.mkdir(mode=0o700)
        isolation = self.fixture.create_environment()
        migrations = self.fixture.migrations()
        self.web_a, self.web_b = (self.fixture.prefix + "-web-" + suffix for suffix in ("a", "b"))
        self.web_names = {self.web_a, self.web_b}
        self.web_images = {self.web_a: self.old_image, self.web_b: self.new_image}
        self.start_caddy()
        self.fixture.realtime()
        self.fixture.start_container("worker", self.retained_images["worker"], ["bun", "dist/worker.mjs"], memory="1024m")
        require(self.fixture.queue_helper("registered") == {"registered": True}, "retained worker did not register its queue")
        self.protected = self.protected_runtimes()
        self.schema_sha = self.schema()
        for suffix, image in (("a", self.old_image), ("b", self.new_image)):
            name = self.fixture.start_container("web-" + suffix, image["imageId"],
                                                ["bun", "--bun", "next", "start"], memory="1536m")
            self.wait_web(name)
            uid = self.docker.run(["exec", name, "id", "-u"], timeout=10).stdout.strip()
            require(re.fullmatch(r"[1-9][0-9]{0,9}", uid), "Web process runs as root or with unknown UID")
            require(self.schema() == self.schema_sha and self.protected_runtimes() == self.protected,
                    "Web startup changed the retained database schema or runtime identities")
        rows = {name: self.owned(name) for name in (self.web_a, self.web_b)}
        self.web_start_times = {name: self.started(row) for name, row in rows.items()}
        common = [common_web_configuration(row, self.web_images[name]["sourceRevision"]) for name, row in rows.items()]
        if common[0] != common[1]:
            self.report["diagnostics"].append({"webConfigChangedFields": changed_fields(*common)})
            raise WebSwitchSmokeError("Web runtime configuration differs outside the reviewed image identity and build stamps")
        return {"isolation": isolation, "migrations": migrations, "schemaSha256": self.schema_sha,
                **({"migratorImageId": self.retained_images["migrator"]} if self.repeat else {}),
                "commonWebConfigSha256": content_hash(common[0]), "availableMemoryBytes": admission["availableBytes"],
                "fixtureMemoryLimitBytes": limit, "hostReserveBytes": 1024 * MIB}

    @staticmethod
    def started(row):
        timestamp = row.get("State", {}).get("StartedAt")
        require(isinstance(timestamp, str) and re.fullmatch(r"20\d\d-\d\d-\d\dT[0-9:.]{8,24}Z", timestamp),
                "owned runtime start time unavailable")
        return timestamp

    def web_runtime(self, name, schema):
        row = self.owned(name)
        image, state = self.web_images[name], row["State"]
        require(row["Image"] == image["imageId"] and self.started(row) == self.web_start_times[name]
                and not state.get("Paused") and not state.get("OOMKilled"), "Web runtime identity or start time changed")
        return {"runtimeId": row["Id"], "name": name, "imageId": row["Image"], "sourceRevision": image["sourceRevision"],
                "configSha256": content_hash(runtime_config(row)), "schemaSha256": schema,
                "restartCount": row.get("RestartCount"), "running": state.get("Running")}

    def protected_runtimes(self):
        expected = {key: self.retained_images[key] for key in ("worker", "realtime")}
        expected["caddy"] = self.caddy_id
        result = {}
        for key in ("postgres", "worker", "realtime", "caddy"):
            row = self.owned(self.fixture.containers[key])
            state = row["State"]
            require(state.get("Running") is True and not state.get("Paused") and not state.get("OOMKilled")
                    and type(row.get("RestartCount")) is int and row["RestartCount"] == 0
                    and IMAGE.fullmatch(row["Image"]) and row["Image"] == expected.get(key, row["Image"]),
                    "protected fixture runtime stopped, restarted or changed image")
            result[key] = {"runtimeId": row["Id"], "imageId": row["Image"], "restartCount": row["RestartCount"],
                           "startedAt": self.started(row), "configSha256": content_hash(runtime_config(row))}
        return result

    def backend_fingerprint(self):
        return content_hash(self.protected_runtimes())

    def forwarder(self, name, port, *, browser=False):
        forwarding = owned_bridge_forwarder(self.docker, owner_label=OWNER_LABEL, owner=self.fixture.prefix,
            network_name=self.fixture.report["resources"]["network"], container_name=name, port=port,
            lifetime_seconds=300 if browser else 12, idle_seconds=60 if browser else 7,
            max_connections=16 if browser else 8, total_bytes=(128 if browser else 64) * MIB,
            connection_bytes=(16 if browser else 5) * MIB).start()
        self.relays.append(forwarding)
        return forwarding.authority

    def start_caddy(self):
        before, after = (WebGeneration(self.web_images[name]["generation"], name) for name in (self.web_a, self.web_b))
        config = self.fixture.output_dir / "ingress"
        config.mkdir(mode=0o755)
        require("," not in str(config), "fixture bind path contains a mount separator")
        certificate = None
        source = fixture_caddyfile(self.web_a, self.fixture.prefix + "-realtime")
        source = source.replace(f" header {GENERATION_HEADER} generation-a\n", "")
        if self.args.browser:
            certificate, key = config / "cert.pem", config / "key.pem"
            self.host(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                       "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1",
                       "-keyout", str(key), "-out", str(certificate)])
            certificate.chmod(0o444)
            key.chmod(0o444)
            source = source.replace("\n:8080 {\n", "\nhttps://:8443 {\n tls /fixture/cert.pem /fixture/key.pem\n")
        (config / "Caddyfile").write_text(source)
        self.caddy_id = caddy_image(self.docker)
        bind = f"type=bind,source={config},target=/fixture,readonly"
        adapted = self.fixture.start_container("caddy-adapt", self.caddy_id,
            ["caddy", "adapt", "--config", "/fixture/Caddyfile", "--adapter", "caddyfile"], environment={},
            mount=bind, memory="256m", network="none", readonly=True, tmpfs=CADDY_TMPFS)
        self.fixture.finished(adapted, 30)
        caddy_storage(self.owned(adapted))
        raw = self.docker.run(["logs", "--tail", "20", adapted], timeout=10).stdout
        require(len(raw.encode()) <= MAX_HTTP_BYTES, "adapted fixture configuration exceeds its byte bound")
        base = json.loads(raw)
        require(base.get("admin", {}).get("origins") == [ADMIN_HOST] and base["admin"].get("enforce_origin") is True
                and base["admin"].get("config", {}).get("persist") is False, "Caddy fixture admin constraints differ")
        self.documents = generation_configs(base, before, after)
        (config / "config.json").write_bytes(canonical(self.documents[before.deployment_id]))
        self.caddy = self.fixture.start_container("caddy", self.caddy_id, ["caddy", "run", "--config", "/fixture/config.json"],
            environment={}, mount=bind, memory="256m", readonly=True, tmpfs=CADDY_TMPFS)
        self.storage = caddy_storage(self.owned(self.caddy))
        self.admin = FixtureHTTP(self.forwarder(self.caddy, 2019), lambda: self.owned(self.caddy), admin=True)
        self.traffic = WebHTTP(self.forwarder(self.caddy, 8443 if certificate else 8080, browser=bool(certificate)), certificate)
        if certificate:
            self.fixture.env.update(BASE_URL=self.traffic.origin, AUTH_TRUSTED_PROXY_HEADER="x-real-ip")
        self.before_generation, self.after_generation = before, after

    def setup_caddy(self):
        before, after = self.before_generation, self.after_generation
        self.direct = {name: WebHTTP(self.forwarder(name, 3000)) for name in (self.web_a, self.web_b)}
        self.direct_readback = {}
        slots = {}
        for item in (before, after):
            client, generation = self.direct[item.target], item.deployment_id
            identity = observe_identity(client, generation, proxied=False)
            paths, count = observe_page(client, generation, proxied=False)
            self.direct_readback[generation] = {"identity": identity, "pageAssetCount": count,
                "assets": {kind: observe_asset(client, generation, kind, path, proxied=False) for kind, path in paths.items()}}
            runtime = self.web_runtime(item.target, self.schema_sha)
            require(runtime["running"] is True and runtime["restartCount"] == 0, "Web slot is unavailable or restarted")
            slots[generation] = {"runtime": runtime, "route": {"generation": generation,
                "runtimeId": runtime["runtimeId"], "fingerprint": content_hash(self.documents[generation])}}
        require(self.protected_runtimes() == self.protected, "protected runtime identity changed before route admission")
        protected = self.protected
        self.qualification = {"assembly": self.assembly, "protectedRuntimes": protected,
            "backendFingerprint": content_hash(protected), "webStartTimes": self.web_start_times,
            "web": self.direct_readback, "slots": slots}
        self.target = MixedCaddyTarget(self, slots, self.documents, self.qualification)
        self.generations = before.deployment_id, after.deployment_id
        observed, _ = self.target.read_route()
        require(observed == slots[before.deployment_id]["route"], "initial Caddy route did not load")
        self.read_ingress(before.deployment_id)
        return {"qualification": self.qualification, "qualificationSha256": content_hash(self.qualification),
                "caddyStorage": self.storage, "relays": [item.target_metadata for item in self.relays]}

    def read_ingress(self, active, *, include_retained=True):
        slot = self.target.slots[active]
        require(self.target.read_route()[0] == slot["route"] and self.target.observe_health(slot, proxied=True)["healthy"],
                "active generation differs from the independently observed healthy ingress")
        paths, count = observe_page(self.traffic, active, proxied=True)
        direct = self.direct_readback[active]
        require(count == direct["pageAssetCount"] and paths == {kind: value["path"] for kind, value in direct["assets"].items()}
                and observe_identity(self.traffic, active, proxied=True) == direct["identity"],
                "proxied login inventory or Web version differs from the direct runtime")
        asset_generations = self.generations if include_retained else (active,)
        for generation in asset_generations:
            value = self.direct_readback[generation]
            for kind, asset in value["assets"].items():
                require(observe_asset(self.traffic, generation, kind, asset["path"], proxied=True) == asset,
                        "pinned ingress asset bytes differ from its direct Web image")
        unknown = "wd-" + next(char * 40 for char in "012" if "wd-" + char * 40 not in self.generations)
        path = paths["css"].rsplit("=", 1)[0] + "=" + unknown
        status, headers, _ = self.traffic.get(path)
        require(status == 409 and headers.get("X-Warpdrive-Web-Rejection") == "before-forward"
                and not headers.get_all(HEADER, []), "unknown generation escaped the compiled before-forward rejection")
        require(self.schema() == self.schema_sha and self.backend_fingerprint() == self.qualification["backendFingerprint"],
                "database schema or protected runtime identities changed")
        return {"activeGeneration": active, "identity": direct["identity"], "verifiedAssetGenerations": list(asset_generations),
                "verifiedAssetsPerGeneration": 2, "unknownGenerationStatus": status,
                "backendFingerprint": self.qualification["backendFingerprint"], "schemaSha256": self.schema_sha}

    def rollout_plan(self, operation, before, after):
        return {"schemaVersion": 1, "kind": "warpdrive-web-rollout", "operationId": operation,
                "targetKey": self.fixture.prefix, "before": self.target.slots[before], "after": self.target.slots[after],
                "backendFingerprint": self.qualification["backendFingerprint"],
                "qualificationSha256": content_hash(self.qualification)}

    def transition(self, operation, before, after, *, initialize=False):
        plan = self.rollout_plan(operation, before, after)
        state_dir = self.private / "rollout-state"
        count = len(self.target.patches)
        receipt = rollout_web(plan, state_dir=state_dir, target=self.target, initialize=initialize)
        require(receipt["state"] == "accepted" and receipt["acceptedGeneration"] == after
                and self.target.patches[count:] == [{"from": before, "to": after}], "expected one accepted Caddy route mutation")
        repeated = rollout_web(plan, state_dir=state_dir, target=self.target)
        require(repeated == receipt and len(self.target.patches) == count + 1, "repeated operation issued another route mutation")
        return {"receipt": receipt, "ingress": self.read_ingress(after), "routeWrites": 1, "repeatReadOnly": True}

    def stop_candidate(self, name):
        require(name == self.web_b, "fault may stop only the owned new Web runtime")
        row = self.owned(name)
        require(row["State"].get("Running") is True, "new Web candidate must be running before the injected fault")
        self.docker.run(["stop", "--time", "10", row["Id"]], timeout=20)
        require(self.web_runtime(name, self.schema())["running"] is False,
                "owned new Web candidate did not stop")

    def automatic_rollback(self, before, after):
        count = len(self.target.patches)
        plan = self.rollout_plan("candidate-fault", before, after)
        state_dir = self.private / "rollout-state"
        self.target.stop_after_switch = after
        receipt = rollout_web(plan, state_dir=state_dir, target=self.target)
        require(receipt["state"] == "rolled-back" and receipt["acceptedGeneration"] == before
                and self.target.stop_after_switch is None
                and self.target.patches[count:] == [{"from": before, "to": after}, {"from": after, "to": before}]
                and self.web_runtime(self.web_b, self.schema())["running"] is False,
                "candidate fault did not restore the retained Web route exactly once")
        require(rollout_web(plan, state_dir=state_dir, target=self.target) == receipt
                and len(self.target.patches) == count + 2, "repeated rollback operation issued another route mutation")
        return {"receipt": receipt, "ingress": self.read_ingress(before, include_retained=False),
                "routeWrites": 2, "candidateStopped": True, "repeatReadOnly": True}

    def verify_browser_source(self, candidate=None):
        def seed_host(arguments, **kwargs):
            return self.host(arguments, root=self.seed_root, **kwargs)

        if self.repeat:
            require(self.seed_root != ROOT, "Repeat seed and browser toolkit require separate exact checkouts")
            require((self.seed_root / "node_modules/better-auth/package.json").is_file()
                    and (ROOT / "tools/browser-smoke/node_modules/playwright/index.mjs").is_file(),
                    "Locked repeat seed and browser dependencies required")
            verify_repeat_harness(ROOT, self.host, self.args.harness_revision, sdk_scenario=self.sdk_scenario)
        admit_source(seed_host, self.revision)
        admit_bundle_source(self.seed_root, self.bundle_dir, candidate or self.baseline_candidate, self.revision)
        for relative in ((SEED_SCRIPT,) if self.repeat else (BROWSER_SCRIPT, SEED_SCRIPT)):
            committed = seed_host(["git", "cat-file", "blob", f"{self.revision}:{relative}"], binary=True)
            require(regular_file(self.seed_root, relative, 65536).read_bytes() == committed,
                    "browser harness bytes differ from the bound baseline source")

    def start_browser(self):
        self.verify_browser_source()
        require((self.seed_root / "node_modules/better-auth/package.json").is_file()
                and (ROOT / "tools/browser-smoke/node_modules/playwright/index.mjs").is_file(),
                "locked browser and application dependencies required")
        database = self.forwarder(self.fixture.containers["postgres"], 5432)
        port = int(database.split(":")[-1])
        environment = source_runtime_environment(self.host_environment, self.fixture.env, port)
        seed = {"revision": self.revision, "baseUrl": self.traffic.origin, "databasePort": port,
                "actorId": str(uuid.uuid4()), "adminId": str(uuid.uuid4()), "pipelineId": str(uuid.uuid4()),
                "permissionId": str(uuid.uuid4()), "email": "web-" + secrets.token_hex(8) + "@example.invalid",
                "adminEmail": "admin-" + secrets.token_hex(8) + "@example.invalid",
                "password": secrets.token_urlsafe(32), "adminPassword": secrets.token_urlsafe(32),
                "pipelineName": "Web rollout fixture"}
        admit_profile(seed, environment)
        seed_path = self.private / "seed.json"
        seed_path.write_text(json.dumps(seed), encoding="utf-8")
        seed_path.chmod(0o600)
        try:
            result = self.host(["bun", "--no-env-file", str(self.seed_root / SEED_SCRIPT), "seed"],
                               environment={**environment, "BROWSER_REALTIME_PROFILE": str(seed_path)},
                               timeout=40, root=self.seed_root)
            admit_fixture_result(json.loads(result), "seed", self.revision)
        finally:
            seed_path.unlink()
        self.browser_profile = {key: seed[key] for key in ("baseUrl", "actorId", "pipelineId", "pipelineName", "email", "password")}
        self.browser_profile.update(previousRevision=self.old_image["sourceRevision"], currentRevision=self.args.new_web_revision,
                                    activitySubject="Web rollout " + secrets.token_hex(12))
        if self.repeat:
            self.browser_profile["scenario"] = REPEAT_BROWSER_PROFILE
        if self.sdk_keyboard_help:
            self.browser_profile["sdkKeyboardHelp"] = True
        if self.sdk_scenario:
            self.browser_profile["sdkScenario"] = self.sdk_scenario
        if getattr(self.args, "topbar_gaps", None) is not None:
            self.browser_profile["topBarGaps"] = self.args.topbar_gaps
        self.browser_profile_path = self.private / "browser.json"
        self.browser_profile_path.write_text(json.dumps(self.browser_profile), encoding="utf-8")
        self.browser_profile_path.chmod(0o600)
        self.browser = RolloutBrowser({**self.host_environment, "BROWSER_WEB_ROLLOUT_PROFILE": str(self.browser_profile_path)},
                                      repeat=self.repeat, sdk_keyboard_help=self.sdk_keyboard_help,
                                      sdk_scenario=self.sdk_scenario)
        self.browser_initial = self.browser.wait("initial-ready", timeout=90)
        require(self.activity_count() == 0, "synthetic browser Activity already exists before rollout")
        return {"freshBoundBaselineSeed": True, "forgedSession": False, "initial": self.browser_initial,
                "matchingActivityRows": 0}

    def activity_count(self):
        actor, subject = self.browser_profile["actorId"], self.browser_profile["activitySubject"]
        require(str(uuid.UUID(actor)) == actor and re.fullmatch(r"Web rollout [0-9a-f]{24}", subject),
                "unexpected synthetic Activity locator")
        query = ("BEGIN READ ONLY; SET LOCAL statement_timeout='3s'; SELECT count(*), "
                 f"count(*) FILTER (WHERE owner_id='{actor}'::uuid) FROM activities WHERE subject='{subject}'; ROLLBACK;")
        postgres = self.fixture.containers["postgres"]
        self.owned(postgres)
        result = self.docker.run(["exec", postgres, "psql", "-XqAt", "-U", "smoke", "-d", "warpdrive_image_smoke",
                                  "-v", "ON_ERROR_STOP=1", "-c", query], timeout=10).stdout.strip()
        require(result in {"0|0", "1|1"}, "synthetic Activity row count or owner differs")
        return int(result[0])

    def finish_browser(self):
        complete = self.browser.wait("complete", timeout=90)
        self.browser.finished()
        for reader in self.browser.readers:
            reader.join(2)
            require(not reader.is_alive(), "browser protocol reader did not finish")
        require(not self.browser.invalid and self.browser.messages.empty(), "unexpected extra browser control evidence")
        require(self.activity_count() == 1, "old-tab Server Action did not create exactly one owned Activity")
        self.verify_browser_source()
        self.report["browserContinuityQualified"] = True
        return {"preSwitch": self.browser_pre_switch, "complete": complete, "matchingActivityRows": 1,
                "generatedLoopbackTls": True}

    def cleanup(self):
        errors, relay_results = [], []
        if self.browser:
            try:
                if self.browser.close():
                    errors.append("owned-browser-cleanup")
                try:
                    os.killpg(self.browser.process.pid, 0)
                except ProcessLookupError:
                    pass
                else:
                    errors.append("owned-browser-group-still-present")
            except Exception:
                errors.append("owned-browser-cleanup")
        for forwarding in reversed(self.relays):
            try:
                forwarding.close()
                value = forwarding.snapshot()
                require(value["closed"] and value["openSockets"] == value["activeConnections"] == 0
                        and value["ownershipFailures"] == value["streamLimitReached"] == 0,
                        "owned relay is still active")
                relay_results.append(value)
            except Exception:
                errors.append("owned-loopback-relay")
        if self.fixture:
            try:
                if self.fixture.cleanup():
                    errors.append("owned-docker-cleanup")
                if not owned_resources_absent(self.docker, self.fixture.resources, self.fixture.prefix):
                    errors.append("owned-docker-absence-readback")
            except Exception:
                errors.append("owned-docker-cleanup-readback")
        return {"success": not errors, "errors": errors, "closedRelays": relay_results,
                "fixtureResourcesAbsent": bool(self.fixture) and not any("docker" in error for error in errors)}

    def run(self):
        self.output_dir.mkdir(mode=0o700, parents=True, exist_ok=False)
        try:
            self.check("authenticated-baseline-and-local-web", self.load)
            self.check("owned-retained-backend-and-two-web-runtimes", self.setup_runtimes)
            self.check("compiled-caddy-and-initial-web", self.setup_caddy)
            before, after = self.generations
            if self.args.browser:
                self.check("native-browser-draft-and-authenticated-socket-before-switch", self.start_browser)
            self.check("forward-web-generation-switch", lambda: self.transition("forward", before, after, initialize=True))
            if self.args.browser:
                self.check("persistent-old-tab-action-and-fresh-realtime-after-switch", self.finish_browser)
            self.check("rollback-to-retained-web-generation", lambda: self.transition("rollback", after, before))
            self.check("stopped-candidate-automatically-restores-retained-web", lambda: self.automatic_rollback(before, after))
        except Exception as error:
            self.report["failure"] = {"check": self.report["checks"][-1]["name"], "type": type(error).__name__}
            if isinstance(error, WebSwitchSmokeError):
                self.report["failure"]["reason"] = str(error)
        finally:
            self.report["cleanup"] = self.cleanup()
            if self.report["failure"] is not None and self.browser is not None:
                self.report["failure"]["browserStages"] = self.browser.failure_stages()
            self.report["finishedAt"] = utc_now()
            self.report["success"] = self.report["failure"] is None and self.report["cleanup"]["success"]
            with (self.output_dir / "report.json").open("x", encoding="utf-8") as report:
                json.dump(self.report, report, indent=2, allow_nan=False)
                report.write("\n")
        return self.report["success"]


def main(arguments=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle-dir", type=Path, required=True)
    parser.add_argument("--baseline-revision", type=validate_revision, required=True)
    parser.add_argument("--baseline-manifest-sha256", required=True)
    parser.add_argument("--new-web-image-id", required=True)
    parser.add_argument("--new-web-revision", type=validate_revision, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--browser", action="store_true", help="require the native persistent browser and durable Activity proof")
    parser.add_argument("--sdk-keyboard-help", action="store_true",
                        help="exercise the authenticated candidate's SDK keyboard-help dialog")
    parser.add_argument("--topbar-gaps", nargs=2, type=int, metavar=("OLD", "NEW"),
                        help="assert the admitted old and new TopBar gaps in the presentation rehearsal")
    parser.add_argument("--active-web-bundle", type=Path)
    parser.add_argument("--active-web-publication-receipt", type=Path)
    parser.add_argument("--active-web-publication-receipt-sha256")
    parser.add_argument("--seed-root", type=Path)
    parser.add_argument("--harness-revision", type=validate_revision)
    parser.add_argument("--successor-web-bundle", type=Path)
    parser.add_argument("--successor-web-publication-receipt", type=Path)
    parser.add_argument("--successor-web-publication-receipt-sha256")
    parser.add_argument("--successor-web-revision", type=validate_revision)
    parser.add_argument("--predecessor-lineage-sha256")
    add_functional_predecessor_options(parser)
    args = parser.parse_args(arguments)
    if not HASH.fullmatch(args.baseline_manifest_sha256) or not IMAGE.fullmatch(args.new_web_image_id):
        parser.error("a full baseline manifest SHA-256 and immutable new Web image ID are required")
    try:
        functional = functional_successor_mode(args)
        repeat = functional or repeat_mode(args)
        require(functional or successor_mode(args) or not args.sdk_keyboard_help,
                "SDK keyboard help requires a successor Web fixture")
        if args.topbar_gaps is not None:
            old, new = args.topbar_gaps
            require(args.browser and not repeat and 0 <= new < old <= 64 and old - new == 2,
                    "TopBar gap assertions require a bounded presentation browser fixture")
    except (OSError, ValueError, WebSwitchSmokeError) as error:
        parser.error(str(error))
    try:
        require(platform.system() == "Linux" and platform.machine() in {"x86_64", "amd64"},
                "native Linux AMD64 host required")
        with tempfile.TemporaryDirectory(prefix="wd-web-mixed-") as directory:
            private = Path(directory).resolve()
            passed = MixedWebSmoke(IsolatedDocker(private / "docker"), args, private).run()
    except Exception as error:
        print(f"Native isolated mixed Web rehearsal could not complete ({type(error).__name__}).", file=sys.stderr)
        return 1
    print(f"Native isolated mixed Web rehearsal {'passed' if passed else 'failed'}. See report.json.")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
