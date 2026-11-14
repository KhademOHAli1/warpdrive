"""Authenticate and reuse final images for an opt-in native fresh Compose rehearsal.

This is a same-run qualification bootstrap, not a publisher or deployment authority.
The baseline archive is verified but never loaded again. Only the API-authenticated
historical engine archive is loaded; all other images must already be present.
"""

import argparse
from hashlib import file_digest, sha256
import io
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import select
import signal
import stat
import subprocess
import sys
import tarfile
import time
import zipfile

from bundle import load_bundle
from candidate import CandidateError, IMAGE_ID, REVISION
from component_inputs import decode
from engine_image_smoke import context_record, engine_metadata, required_checks_passed
from fresh_compose_admission import IMAGE, IMAGES
from fresh_compose_smoke import (ROOT, FreshCommandUnknown, FreshMutationUnknown, _native_host, _write_env,
                                 run as run_fresh, run_owned_fixture_command)
from image_smoke import image_metadata
from publication_gate import GitHub, REPO
from registry_smoke import IsolatedDocker, RegistrySmoke
from web_baseline import artifact_for_run, successful_main_run
from web_candidate import verify_saved_web_image
from web_publication_gate import ZipReader, copy_bytes, download, private_file
from web_release_rehearsal import verify_built


MAX_METADATA = 512 * 1024
MAX_ENGINE_ZIP = 512 * 1024**2
MAX_ENGINE_TAR = 1024**3
HASH = re.compile(r"[a-f0-9]{64}\Z")
SUPPORT = {"caddy": "caddy", "postgres": "postgres", "storage": "minio", "storage_init": "createbuckets", "registry": None}
ENGINE_WORKFLOW = "production-engine.yml"
ENGINE_JOB = "Final Linux newsletter engine"
ENGINE_STEP = "Qualify actual final-image migration and runtime boundaries"
RECOVERY_KIND = "warpdrive-native-fresh-compose-recovery-smoke"
RECOVERY_REQUEST_BYTES = 16 * 1024
RECOVERY_OUTPUT_BYTES = 128 * 1024
RECOVERY_ERROR_BYTES = 64 * 1024
RECOVERY_TRANSPORT_SECONDS = 1560
RECOVERY_ENV = {"PATH": "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin", "LC_ALL": "C", "TZ": "UTC",
                "PYTHONDONTWRITEBYTECODE": "1"}


class QualificationError(CandidateError):
    """A fixed source-authored gate fact, safe for finite diagnostics."""


def require(condition, message):
    if not condition:
        raise QualificationError(message)


def failure_fact(error):
    # External tool/API exceptions can contain argv, paths or credentials. Only
    # this module's fixed messages enter the shareable receipt.
    return {"failureType": type(error).__name__, **({"failureFact": str(error)} if type(error) is QualificationError else {})}


def write_progress(path, value):
    """Replace only a receipt in the already-private, newly created output."""
    raw = json.dumps(value, sort_keys=True, allow_nan=False).encode() + b"\n"
    require(len(raw) <= MAX_METADATA, "Bounded qualification progress required")
    temporary = path.parent / (".qualification-progress-" + os.urandom(8).hex())
    with private_file(temporary) as output:
        output.write(raw)
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, path)
    directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def pending_outcome(output):
    """Recover the conservative intent even if a later receipt write failed."""
    for name in ("engine-load-progress.json", "session-progress.json"):
        path = output / name
        if not os.path.lexists(path):
            continue
        try:
            value = metadata(path)
            if type(value) is not dict:
                return True
            if value.get("manualReconciliationRequired") is True or value.get("mutationOutcomeUnknown") is True:
                return True
            if value.get("state") == "load-intent":
                return True
            if value.get("success") is not True and value.get("phase") in {"fresh-intent", "recovery-intent"}:
                return True
        except Exception:
            return True
    return False


def metadata(path):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and not path.is_symlink() and info.st_size <= MAX_METADATA,
            "Bounded regular qualification metadata required")
    return decode(path.read_bytes())


def git_value(root, *arguments):
    result = subprocess.run(["git", "--no-replace-objects", *arguments], cwd=root, capture_output=True,
                            stdin=subprocess.DEVNULL, timeout=15, check=False)
    require(result.returncode == 0 and len(result.stdout) <= 1024, "Qualification source object is unavailable")
    return result.stdout.decode("ascii", "strict").strip()


def producer_origin(api, revision, environment):
    """Bind local bundle origin to the actual API run, not caller-authored JSON."""
    require(environment.get("GITHUB_ACTIONS") == "true" and environment.get("RUNNER_ENVIRONMENT") == "github-hosted"
            and environment.get("GITHUB_REPOSITORY") == REPO and environment.get("GITHUB_SHA") == revision
            and environment.get("GITHUB_EVENT_NAME") == "workflow_dispatch"
            and environment.get("GITHUB_REF", "").startswith("refs/heads/"), "Fresh rehearsal requires its hosted dispatch origin")
    run_id, attempt = environment.get("GITHUB_RUN_ID", ""), environment.get("GITHUB_RUN_ATTEMPT", "")
    require(re.fullmatch(r"[1-9][0-9]{0,19}", run_id) and re.fullmatch(r"[1-9][0-9]{0,5}", attempt),
            "Exact producer run and attempt required")
    repository = api.request(f"repos/{REPO}")
    require(repository.get("full_name") == REPO and type(repository.get("id")) is int and repository["id"] > 0,
            "Canonical qualification repository required")
    workflow = api.request(f"repos/{REPO}/actions/workflows/production-images.yml")
    run = api.request(f"repos/{REPO}/actions/runs/{run_id}")
    require(type(workflow.get("id")) is int and workflow.get("path") == ".github/workflows/production-images.yml"
            and run.get("id") == int(run_id) and run.get("run_attempt") == int(attempt)
            and run.get("workflow_id") == workflow["id"] and run.get("path") == workflow["path"]
            and run.get("head_sha") == revision and run.get("head_branch") == environment["GITHUB_REF"][11:]
            and run.get("event") == "workflow_dispatch" and run.get("status") == "in_progress"
            and run.get("conclusion") is None
            and (run.get("repository") or {}).get("id") == repository["id"]
            and (run.get("head_repository") or {}).get("id") == repository["id"], "Current API producer differs from qualification origin")
    return {"kind": "github-actions", "repository": REPO, "runId": int(run_id), "runAttempt": int(attempt),
            "event": "workflow_dispatch", "ref": environment["GITHUB_REF"]}, repository["id"]


def engine_origin(api, run_id, revision, repository_id):
    require(type(run_id) is int and run_id > 0 and isinstance(revision, str) and REVISION.fullmatch(revision),
            "Exact historical engine run and revision required")
    run = successful_main_run(api, ENGINE_WORKFLOW, run_id, revision, repository_id, events={"push", "workflow_dispatch"})
    jobs = api.pages(f"repos/{REPO}/actions/runs/{run_id}/attempts/{run['run_attempt']}/jobs", "jobs")
    jobs = [job for job in jobs if job.get("name") == ENGINE_JOB]
    require(len(jobs) == 1 and jobs[0].get("status") == "completed" and jobs[0].get("conclusion") == "success",
            "Historical engine qualification job must pass")
    steps = [step for step in jobs[0].get("steps", []) if step.get("name") == ENGINE_STEP]
    require(len(steps) == 1 and steps[0].get("conclusion") == "success", "Actual engine runtime qualification step required")
    name = f"production-engine-{revision}-{run_id}-{run['run_attempt']}"
    return artifact_for_run(api, run, repository_id, name, maximum=MAX_ENGINE_ZIP)


def extract_engine(archive, destination, artifact):
    """Read only three required files from the API-hashed bounded artifact."""
    descriptor = os.open(archive, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with ZipReader(io.FileIO(descriptor, "rb")) as source:
        info = os.fstat(source.fileno())
        require(stat.S_ISREG(info.st_mode) and 0 < info.st_size == artifact["sizeBytes"] <= MAX_ENGINE_ZIP,
                "Engine artifact size or type differs")
        source.maximum_read = 1024 * 1024
        require("sha256:" + file_digest(source, "sha256").hexdigest() == artifact["digest"],
                "Engine artifact differs from API digest")
        source.maximum_read = 128 * 1024
        with zipfile.ZipFile(source) as package:
            entries = package.infolist()
            names = [entry.filename for entry in entries]
            required = {"engine-image.tar": MAX_ENGINE_TAR, "engine-image.tar.sha256": 4096, "smoke/report.json": MAX_METADATA}
            require(0 < len(entries) <= 128 and len(set(names)) == len(names) and required.keys() <= set(names),
                    "Engine artifact inventory differs")
            total = 0
            for entry in entries:
                path = PurePosixPath(entry.filename)
                total += entry.file_size
                require(entry.orig_filename == entry.filename and not path.is_absolute() and ".." not in path.parts
                        and "\\" not in entry.filename and len(entry.filename) <= 256
                        and stat.S_IFMT(entry.external_attr >> 16) in (0, stat.S_IFREG, stat.S_IFDIR)
                        and not entry.flag_bits & 1 and entry.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)
                        and entry.file_size <= MAX_ENGINE_TAR and total <= MAX_ENGINE_TAR + 256 * 1024**2,
                        "Unsafe or oversized engine artifact member")
            destination.mkdir(mode=0o700)
            source.maximum_read = 1024 * 1024
            hashes = {}
            for name, maximum in required.items():
                require(0 < package.getinfo(name).file_size <= maximum and not package.getinfo(name).is_dir(),
                        "Engine qualification file is invalid")
                target = destination / Path(name).name
                with package.open(name) as stream, private_file(target) as output:
                    hashes[name] = copy_bytes(stream.read, output, package.getinfo(name).file_size)
                    output.flush()
                    os.fsync(output.fileno())
        after = os.fstat(source.fileno())
        require((info.st_size, info.st_mtime_ns, info.st_ctime_ns) == (after.st_size, after.st_mtime_ns, after.st_ctime_ns),
                "Engine artifact changed during readback")
    checksum = (destination / "engine-image.tar.sha256").read_text(encoding="ascii").split()
    require(len(checksum) == 2 and checksum[0] == hashes["engine-image.tar"]
            and PurePosixPath(checksum[1].lstrip("*")).name == "engine-image.tar", "Engine archive checksum differs")
    return metadata(destination / "report.json"), hashes["engine-image.tar"]


def engine_archive_identity(path, image, revision, context_sha):
    """Admit the exact single saved engine before Docker can load its contents."""
    configs, manifest, names = {}, None, set()
    identifier = image["id"].split(":", 1)[1]
    config_paths = {"blobs/sha256/" + identifier, identifier + ".json"}
    with tarfile.open(path, "r:") as archive:
        total = 0
        for entry in archive:
            name = PurePosixPath(entry.name)
            total += entry.size
            require(len(names) < 8192 and entry.name not in names and not name.is_absolute() and ".." not in name.parts
                    and "\\" not in entry.name and (entry.isfile() or entry.isdir()) and entry.size <= MAX_ENGINE_TAR
                    and total <= MAX_ENGINE_TAR, "Engine image archive inventory is unsafe or oversized")
            names.add(entry.name)
            if entry.name in {"manifest.json", *config_paths}:
                require(entry.isfile() and 0 < entry.size <= MAX_METADATA, "Engine archive metadata exceeds its bound")
                raw = archive.extractfile(entry).read(MAX_METADATA + 1)
                require(len(raw) == entry.size, "Engine archive metadata is truncated")
                if entry.name == "manifest.json":
                    manifest = decode(raw)
                else:
                    require("sha256:" + sha256(raw).hexdigest() == image["id"], "Engine config bytes differ from its reported ID")
                    configs[entry.name] = decode(raw)
    require(type(manifest) is list and len(manifest) == 1 and type(manifest[0]) is dict
            and manifest[0].get("Config") in configs and type(manifest[0].get("Layers")) is list
            and 0 < len(manifest[0]["Layers"]) <= 128 and all(type(layer) is str and layer in names for layer in manifest[0]["Layers"]),
            "Exactly one complete reported engine image is required")
    selected = configs[manifest[0]["Config"]]
    require(type(selected) is dict, "Engine image config is invalid")
    row = {"Id": image["id"], "Config": selected.get("config"), "Os": selected.get("os"), "Architecture": selected.get("architecture")}
    require(engine_metadata([row], revision, context_sha) == image, "Saved engine identity differs from runtime report")


def authenticate_engine(api, docker, args, repository_id, output, *, fetch=download):
    require(isinstance(args.engine_revision, str) and REVISION.fullmatch(args.engine_revision)
            and isinstance(args.expected_revision, str) and REVISION.fullmatch(args.expected_revision),
            "Literal full source revisions required before Git or artifact access")
    original_tree = git_value(ROOT, "rev-parse", f"{args.engine_revision}:deploy/newsletters/engine")
    require(original_tree == git_value(ROOT, "rev-parse", f"{args.expected_revision}:deploy/newsletters/engine"),
            "Historical engine source projection differs from selected source")
    context = context_record()
    artifact = engine_origin(api, args.engine_run_id, args.engine_revision, repository_id)
    archive, directory = output / "engine-artifact.zip", output / "engine-artifact"
    fetch(artifact, archive)
    report, archive_hash = extract_engine(archive, directory, artifact)
    require(report.get("success") is True and (report.get("cleanup") or {}).get("success") is True
            and report.get("expectedRevision") == args.engine_revision and report.get("context") == context
            and required_checks_passed(report.get("checks")), "Authenticated engine runtime evidence or source context differs")
    require(engine_origin(api, args.engine_run_id, args.engine_revision, repository_id) == artifact,
            "Engine API artifact changed during readback")
    image = report.get("image", {})
    require(isinstance(image.get("id"), str) and IMAGE_ID.fullmatch(image["id"]), "Engine report image ID is invalid")
    engine_archive_identity(directory / "engine-image.tar", image, args.engine_revision, context["sha256"])
    progress = {"kind": "warpdrive-authenticated-engine-load", "state": "load-intent", "imageId": image["id"],
                "archiveSha256": archive_hash, "sourceRevision": args.engine_revision}
    write_progress(output / "engine-load-progress.json", progress)
    try:
        docker.run(["image", "load", "--input", str(directory / "engine-image.tar")], timeout=180)
        actual = engine_metadata(docker.json(["image", "inspect", image["id"]], timeout=10), args.engine_revision, context["sha256"])
        require(actual == image, "Loaded engine differs from API-authenticated runtime evidence")
    except (Exception, KeyboardInterrupt) as error:
        raise FreshMutationUnknown("Engine load requires independent outcome reconciliation") from error
    write_progress(output / "engine-load-progress.json", {**progress, "state": "loaded-and-independently-verified"})
    return actual, {"artifact": artifact, "archiveSha256": archive_hash, "sourceTree": original_tree,
                    "revision": args.engine_revision, "contextSha256": context["sha256"]}


def admit_images(api, docker, args, environment, output):
    require(isinstance(args.expected_revision, str) and REVISION.fullmatch(args.expected_revision)
            and git_value(ROOT, "rev-parse", "HEAD") == args.expected_revision, "Exact checked-out qualification source required")
    require(docker.run(["info", "--format", "{{.OSType}} {{.Architecture}}"], timeout=10).stdout.strip()
            in {"linux x86_64", "linux amd64"}, "Native Linux AMD64 Docker daemon required before registry startup")
    origin, repository_id = producer_origin(api, args.expected_revision, environment)
    loaded = load_bundle(args.bundle_dir, expected_revision=args.expected_revision)
    require(loaded["origin"] == origin, "Baseline is not from the authenticated current producer")
    roles, revisions = {}, {}
    for role, image in loaded["candidate"]["components"].items():
        rows = docker.json(["image", "inspect", image["imageId"]], timeout=10)
        actual = image_metadata(rows, args.expected_revision)
        require(actual["id"] == image["imageId"] and actual["user"] == image["runtimeUser"]
                and rows[0].get("Os") == "linux" and rows[0].get("Architecture") == "amd64", "Preloaded baseline differs from authenticated bundle")
        roles[role], revisions[role] = actual["id"], args.expected_revision
    require(set(roles) == {"web", "worker", "realtime", "migrator"} and len(set(roles.values())) == 4,
            "Four distinct admitted baseline images required")
    proof = metadata(args.web_build_proof)
    web_id = proof.get("candidateWebImageId")
    require(isinstance(web_id, str) and IMAGE_ID.fullmatch(web_id) and web_id not in roles.values(), "Distinct candidate Web image required")
    verified = verify_built(ROOT, args.web_scratch, args.bundle_dir, args.expected_revision,
                            loaded["provenance"]["bundleManifestSha256"], web_id)
    require(set(proof) == set(verified) and {k: v for k, v in proof.items() if k != "availableDiskBytesAfterBuild"}
            == {k: v for k, v in verified.items() if k != "availableDiskBytesAfterBuild"}, "Candidate build proof differs from reverified source")
    archive = metadata(args.web_archive_proof)
    web_revision = verified["sourceDelta"]["releaseRevision"]
    candidate = image_metadata(docker.json(["image", "inspect", web_id], timeout=10), web_revision)
    require(archive == verify_saved_web_image(args.web_scratch, expected_image_id=web_id, expected_revision=web_revision)
            and set(archive) == {"image", "archiveSha256", "archiveSizeBytes"}
            and archive["image"] == {"imageId": web_id, "sourceRevision": web_revision, "runtimeUser": candidate["user"],
                                      "generation": "wd-" + web_revision}
            and isinstance(archive["archiveSha256"], str) and HASH.fullmatch(archive["archiveSha256"])
            and type(archive["archiveSizeBytes"]) is int and 0 < archive["archiveSizeBytes"] <= 4 * 1024**3,
            "Candidate archive proof differs from the exact reviewed Web")
    roles["candidate_web"], revisions["candidate_web"] = web_id, web_revision
    supports = {}
    for role in SUPPORT:
        reference = getattr(args, role + "_image")
        require(isinstance(reference, str) and len(reference) <= 255 and IMAGE.fullmatch(reference),
                "Five explicit immutable support images required")
        rows = docker.json(["image", "inspect", reference], timeout=10)
        require(len(rows) == 1 and rows[0].get("Os") == "linux" and rows[0].get("Architecture") == "amd64"
                and isinstance(rows[0].get("Id"), str) and IMAGE_ID.fullmatch(rows[0]["Id"])
                and reference in (rows[0].get("RepoDigests") or []), "Support image is not preloaded at its literal native digest")
        supports[role] = {"reference": reference, "imageId": rows[0]["Id"]}
    storage_client = getattr(args, "storage_client_bin", "mc")
    require(storage_client in {"mc", "mcli"}, "Explicit supported storage client binary required")
    storage_alias = storage_client == "mcli" and supports["storage"]["imageId"] == supports["storage_init"]["imageId"]
    distinct_supports = [entry["imageId"] for role, entry in supports.items() if not (role == "storage_init" and storage_alias)]
    require(len(set(distinct_supports)) == len(distinct_supports)
            and not set(distinct_supports) & set(roles.values()),
            "Only the explicit bundled mcli storage/client image pair may share a support identity")
    engine, custody = authenticate_engine(api, docker, args, repository_id, output)
    require(engine["id"] not in set(roles.values()) | {row["imageId"] for row in supports.values()}, "Engine image role must be distinct")
    roles["engine"], revisions["engine"] = engine["id"], engine["revision"]
    require(producer_origin(api, args.expected_revision, environment) == (origin, repository_id),
            "Current producer changed during image authentication")
    return roles, revisions, supports, {"producer": origin, "baseline": loaded["provenance"], "engine": custody,
                                         "candidateArchiveSha256": archive["archiveSha256"]}


def publish_roles(registry, docker, roles, revisions):
    require(set(roles) == {"web", "worker", "realtime", "migrator", "candidate_web", "engine"}
            and len(set(roles.values())) == 6 and set(revisions) == set(roles), "Six fixed admitted local image roles required")
    registry.image_ids = dict(roles)
    sizes = []
    for role, image in roles.items():
        rows = docker.json(["image", "inspect", image], timeout=10)
        actual = image_metadata(rows, revisions[role])
        require(actual["id"] == image and rows[0].get("Os") == "linux" and rows[0].get("Architecture") == "amd64",
                "Admitted local image identity changed before registry startup")
        sizes.append(rows[0].get("Size"))
    require(all(type(size) is int and size > 0 for size in sizes), "Actual registry image storage sizes required")
    registry.disk_limit = sum(sizes) + 256 * 1024**2
    registry.setup_registry()
    references = {}
    for role, image in roles.items():
        tag = registry.repository_prefix + "/" + role + ":qualified"
        registry.adapter.push(image, tag)
        manifest = registry.client.manifest(tag)
        require(manifest is not None, "Published fixture manifest unavailable")
        reference = tag.rsplit(":", 1)[0] + "@" + manifest[0]
        verified = registry.client.verify_config(reference, image, revisions[role])
        rows = docker.json(["image", "inspect", reference], timeout=10)
        require(verified["imageId"] == image and len(rows) == 1 and rows[0].get("Id") == image
                and reference in (rows[0].get("RepoDigests") or []), "Local digest custody differs from independently verified registry")
        references[role] = reference
    return references


def fixture_references(references, supports):
    baseline = {"app": references["web"], "worker": references["worker"], "ws": references["realtime"],
                "migrate": references["migrator"], "newsletter-engine": references["engine"],
                "newsletter-engine-migrate": references["engine"]}
    baseline.update({service: supports[role]["reference"] for role, service in SUPPORT.items() if service})
    return baseline, {**baseline, "app": references["candidate_web"]}


def recovery_request(baseline, candidate, *, restic, restic_pin, pg_control, pg_control_pin, output_parent,
                     storage_client_bin="mc"):
    value = {"schemaVersion": 1, "kind": "warpdrive-privileged-fixture-recovery-request", "baseline": baseline,
             "candidate": candidate, "restic": str(restic), "resticSha256": restic_pin,
             "pgControl": str(pg_control), "pgControlSha256": pg_control_pin, "outputParent": str(output_parent),
             "storageClientBin": storage_client_bin}
    validate_recovery_request(value)
    return value


def validate_recovery_request(value):
    require(type(value) is dict and set(value) == {"schemaVersion", "kind", "baseline", "candidate", "restic",
            "resticSha256", "pgControl", "pgControlSha256", "outputParent", "storageClientBin"}
            and type(value["schemaVersion"]) is int and value["schemaVersion"] == 1
            and value["kind"] == "warpdrive-privileged-fixture-recovery-request", "Exact privileged recovery request required")
    services = {service for names in IMAGES.values() for service in names}
    for phase in ("baseline", "candidate"):
        refs = value[phase]
        require(type(refs) is dict and set(refs) == services and all(type(ref) is str and len(ref) <= 255
                and IMAGE.fullmatch(ref) for ref in refs.values()), "Exact immutable recovery fixture references required")
    require(value["baseline"]["app"].rsplit("@", 1)[1] != value["candidate"]["app"].rsplit("@", 1)[1]
            and {**value["candidate"], "app": value["baseline"]["app"]} == value["baseline"],
            "Privileged fixture may change only its Web image")
    for key in ("restic", "pgControl", "outputParent"):
        raw = value[key]
        require(type(raw) is str and 0 < len(raw.encode()) <= 4096 and raw.startswith("/")
                and str(PurePosixPath(raw)) == raw and ".." not in PurePosixPath(raw).parts
                and not any(ord(char) < 32 or ord(char) == 127 for char in raw), "Canonical recovery control path required")
    require(all(type(value[key]) is str and HASH.fullmatch(value[key]) for key in ("resticSha256", "pgControlSha256"))
            and value["storageClientBin"] in {"mc", "mcli"}, "Exact recovery tool pins and client profile required")
    require(len(json.dumps(value, sort_keys=True, allow_nan=False).encode()) <= RECOVERY_REQUEST_BYTES,
            "Privileged recovery request exceeds its bound")
    return value


def held_recovery(reason):
    return {"schemaVersion": 1, "kind": RECOVERY_KIND, "success": False, "cleanupSuccess": False,
            "manualReconciliationRequired": True, "outcomeUnknown": True, "failureType": "RecoveryTransportHold",
            "failureFact": reason, "applicationRecoveryAccepted": False, "offHostAccepted": False,
            "keyCustodyAccepted": False, "writerResumptionAuthorized": False}


def recovery_result(value, request):
    """Closed, nonsecret projection; private controls and raw diagnostics stay on the host."""
    require(type(value) is dict and value.get("kind") == RECOVERY_KIND and type(value.get("schemaVersion")) is int
            and value["schemaVersion"] == 1, "Exact privileged recovery result required")
    flags = ("success", "cleanupSuccess", "manualReconciliationRequired", "applicationRecoveryAccepted", "offHostAccepted",
             "keyCustodyAccepted", "writerResumptionAuthorized")
    require(all(type(value.get(key)) is bool for key in flags)
            and not any(value[key] for key in flags[3:]), "Privileged recovery acceptance flags differ")
    result = {"schemaVersion": 1, "kind": RECOVERY_KIND, **{key: value[key] for key in flags}}
    for key in ("fixtureWritersMayBeRunning", "sourceWritersStopped", "sourceAbsentAtIndependentRestore", "writerSlotRevoked", "outcomeUnknown"):
        if key in value:
            require(type(value[key]) is bool, "Recovery fixture state must be explicit")
            result[key] = value[key]
    if "storageClientBin" in value:
        require(value["storageClientBin"] == request["storageClientBin"], "Recovery client differs from admitted request")
        result["storageClientBin"] = value["storageClientBin"]
    if "outputDirectory" in value:
        directory = value["outputDirectory"]
        child = Path(request["outputParent"]) / "recovery-root"
        require(type(directory) is str and len(directory) <= 4096 and str(PurePosixPath(directory)) == directory
                and ".." not in PurePosixPath(directory).parts and not any(ord(char) < 32 for char in directory)
                and (Path(directory) == child or (Path(directory).parent == child
                     and re.fullmatch(r"wd-fresh-recovery-[a-z0-9_-]{6,64}", Path(directory).name))),
                "Privileged result escaped its retained private directory")
        result["outputDirectory"] = directory
    if "project" in value:
        require(type(value["project"]) is str and re.fullmatch(r"wd-fresh-[a-f0-9]{16}", value["project"]),
                "Recovery fixture project differs")
        result["project"] = value["project"]
    for key in ("phase", "failure"):
        if key in value:
            require(type(value[key]) is str and re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,95}", value[key]),
                    "Recovery result fact is invalid")
            result[key] = value[key]
    if "durationSeconds" in value:
        duration = value["durationSeconds"]
        require(type(duration) in (int, float) and math.isfinite(duration) and 0 <= duration <= RECOVERY_TRANSPORT_SECONDS,
                "Recovery duration is invalid")
        result["durationSeconds"] = duration
    if "recovery" in value:
        proof = value["recovery"]
        keys = {"snapshotId", "manifestSha256", "receiptSha256", "restoredBytes", "restoredEntries",
                "isolatedRestoreBytesVerified", "restartedSyntheticServicesQualified"}
        require(type(proof) is dict and set(proof) == keys
                and all(type(proof[key]) is str and HASH.fullmatch(proof[key]) for key in ("snapshotId", "manifestSha256", "receiptSha256"))
                and type(proof["restoredBytes"]) is int and 0 <= proof["restoredBytes"] <= 1024**3
                and type(proof["restoredEntries"]) is int and 0 < proof["restoredEntries"] <= 20000
                and proof["isolatedRestoreBytesVerified"] is True and proof["restartedSyntheticServicesQualified"] is True,
                "Privileged recovery proof differs")
        result["recovery"] = proof
    if value["success"]:
        require(value["cleanupSuccess"] and not value["manualReconciliationRequired"]
                and value.get("fixtureWritersMayBeRunning") is False and value.get("sourceAbsentAtIndependentRestore") is True
                and value.get("sourceWritersStopped") is True and value.get("writerSlotRevoked") is True
                and value.get("storageClientBin") == request["storageClientBin"] and "recovery" in result,
                "Privileged recovery success lacks its cleanup or source-absence proof")
    else:
        require(value["manualReconciliationRequired"], "Failed recovery must remain held")
    require(len(json.dumps(result, sort_keys=True, allow_nan=False).encode()) <= RECOVERY_OUTPUT_BYTES,
            "Privileged recovery result exceeds its bound")
    return result


def _stop_recovery_transport(process):
    # sudo forwarding and permissions do not prove privileged descendants stopped.
    # Keep the result unknown and the registry held even if our leader exits.
    for signum in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(process.pid, signum)
        except (ProcessLookupError, PermissionError):
            pass
    try:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        pass


def sudo_recovery(baseline, candidate, *, restic, restic_pin, pg_control, pg_control_pin, output_parent,
                  storage_client_bin="mc"):
    request = recovery_request(baseline, candidate, restic=restic, restic_pin=restic_pin, pg_control=pg_control,
                               pg_control_pin=pg_control_pin, output_parent=output_parent, storage_client_bin=storage_client_bin)
    arguments = ["sudo", "-n", str(Path(sys.executable).resolve(strict=True)), "-B", str(Path(__file__).resolve(strict=True)),
                 "--internal-cold-recovery"]
    raw = json.dumps(request, sort_keys=True, allow_nan=False).encode()
    process, completed = None, False
    try:
        process = subprocess.Popen(arguments, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   env=dict(RECOVERY_ENV), start_new_session=True)
        os.set_blocking(process.stdin.fileno(), False)
        pending, output, errors = memoryview(raw), bytearray(), bytearray()
        streams = {process.stdout: output, process.stderr: errors}
        deadline = time.monotonic() + RECOVERY_TRANSPORT_SECONDS
        while streams or pending is not None:
            remaining = deadline - time.monotonic()
            require(remaining > 0, "Privileged recovery transport deadline exceeded")
            readable, writable, _ = select.select(list(streams), [process.stdin] if pending is not None else [], [], min(0.2, remaining))
            if writable:
                count = os.write(process.stdin.fileno(), pending[:4096])
                require(count > 0, "Privileged recovery request made no progress")
                pending = pending[count:]
                if not pending:
                    process.stdin.close()
                    pending = None
            for stream in readable:
                chunk = os.read(stream.fileno(), 65536)
                if not chunk:
                    del streams[stream]
                else:
                    streams[stream].extend(chunk)
                    require(len(output) <= RECOVERY_OUTPUT_BYTES and len(errors) <= RECOVERY_ERROR_BYTES,
                            "Privileged recovery output exceeded its bound")
        status = process.wait(timeout=max(0.01, min(5, deadline - time.monotonic())))
        require(status in (0, 1), "Privileged recovery subprocess did not return a terminal result")
        result = recovery_result(decode(bytes(output)), request)
        require((status == 0) is result["success"], "Privileged recovery exit status differs from its result")
        completed = True
        return result
    except (Exception, KeyboardInterrupt):
        return held_recovery("privileged-transport-or-result-unknown")
    finally:
        if process is not None:
            if not completed:
                _stop_recovery_transport(process)
            for stream in (process.stdin, process.stdout, process.stderr):
                if stream is not None:
                    stream.close()


def internal_cold_recovery():
    """Privileged stdin-only entrypoint: no source, Git, registry or API operations."""
    request = None
    try:
        raw = sys.stdin.buffer.read(RECOVERY_REQUEST_BYTES + 1)
        require(0 < len(raw) <= RECOVERY_REQUEST_BYTES, "Bounded privileged recovery input required")
        request = validate_recovery_request(decode(raw))
        owner = os.environ.get("SUDO_UID", "")
        require(os.geteuid() == 0 and re.fullmatch(r"[1-9][0-9]{0,9}", owner), "Explicit sudo recovery identity required")
        from recovery import DirectoryHandle
        parent = Path(request["outputParent"])
        require(parent == parent.resolve(strict=True), "Canonical private recovery parent required")
        handle = DirectoryHandle(parent)
        try:
            info = os.fstat(handle.fd)
            require(info.st_uid == int(owner) and stat.S_IMODE(info.st_mode) == 0o700,
                    "Privileged recovery parent must belong to its original private runner")
            os.mkdir("recovery-root", 0o700, dir_fd=handle.fd)
            handle.check()
            child = parent / "recovery-root"
            observed = child.lstat()
            require(stat.S_ISDIR(observed.st_mode) and observed.st_uid == 0 and stat.S_IMODE(observed.st_mode) == 0o700,
                    "New private root recovery directory required")
        finally:
            handle.close()
        from fresh_compose_recovery_smoke import run as run_recovery
        result = run_recovery(request["baseline"], request["candidate"], restic=Path(request["restic"]),
            restic_pin=request["resticSha256"], pg_control=Path(request["pgControl"]), pg_control_pin=request["pgControlSha256"],
            output_parent=child, storage_client_bin=request["storageClientBin"])
        result = recovery_result(result, request)
    except (Exception, KeyboardInterrupt):
        result = held_recovery("privileged-coordinator-held")
    sys.stdout.write(json.dumps(result, sort_keys=True, allow_nan=False) + "\n")
    return 0 if result["success"] else 1


def exercise_session(docker, args, roles, revisions, supports, *, fresh=run_fresh, recovery=None, registry_factory=RegistrySmoke):
    registry = registry_factory(docker, args.bundle_dir, args.expected_revision, args.output_dir / "registry",
                                registry_image=supports["registry"]["reference"], registry_preloaded=True)
    receipt = {"success": False, "nativeExecutionPending": True, "deploymentAuthorized": False,
               "registryCleanupSuccess": False, "manualReconciliationRequired": False,
               "storageClientBinary": getattr(args, "storage_client_bin", "mc")}
    fixtures_clean = True
    publication_pending = True
    unknown = False
    try:
        receipt.update(phase="registry-publication-intent", mutationOutcomeUnknown=True)
        write_progress(args.output_dir / "session-progress.json", receipt)
        references = publish_roles(registry, docker, roles, revisions)
        publication_pending = False
        receipt.update(phase="registry-publication-verified", mutationOutcomeUnknown=False)
        write_progress(args.output_dir / "session-progress.json", receipt)
        baseline, candidate = fixture_references(references, supports)
        for phase, refs in (("baseline", baseline), ("candidate", candidate)):
            _write_env(args.output_dir / f"{phase}-images.env", {
                **{key: refs[services[0]] for key, services in IMAGES.items()},
                "WARPDRIVE_STORAGE_CLIENT_BIN": getattr(args, "storage_client_bin", "mc"),
            })
        receipt["imageEnvironmentSha256"] = {phase: sha256((args.output_dir / f"{phase}-images.env").read_bytes()).hexdigest()
                                             for phase in ("baseline", "candidate")}
        receipt["images"] = {role: {"imageId": roles[role], "revision": revisions[role], "reference": references[role]} for role in roles}
        fixtures_clean = False
        receipt["phase"] = "fresh-intent"
        write_progress(args.output_dir / "session-progress.json", receipt)
        receipt["fresh"] = fresh(baseline, candidate, storage_client_bin=getattr(args, "storage_client_bin", "mc"))
        fixtures_clean = (receipt["fresh"].get("cleanupSuccess") is True
                          and receipt["fresh"].get("manualReconciliationRequired") is not True)
        require(receipt["fresh"].get("success") is True and fixtures_clean, "Fresh native fixture did not pass and clean up")
        receipt["nativeExecutionPending"] = False
        if recovery is not None:
            fixtures_clean = False
            receipt["phase"] = "recovery-intent"
            write_progress(args.output_dir / "session-progress.json", receipt)
            receipt["recovery"] = recovery(baseline, candidate)
            fixtures_clean = (receipt["recovery"].get("cleanupSuccess") is True
                              and receipt["recovery"].get("manualReconciliationRequired") is not True)
            require(receipt["recovery"].get("success") is True and fixtures_clean, "Fresh recovery fixture did not pass and clean up")
        receipt["success"] = True
    except (Exception, KeyboardInterrupt) as error:
        unknown = publication_pending or isinstance(error, FreshCommandUnknown)
        receipt.update(phase="held", mutationOutcomeUnknown=unknown, **failure_fact(error))
    finally:
        if fixtures_clean and not unknown:
            try:
                errors = registry.cleanup()
                receipt["registryCleanupSuccess"] = not errors
                if errors:
                    receipt["registryCleanupErrors"] = errors
            except Exception as error:
                receipt["registryCleanupFailureType"] = type(error).__name__
        receipt["manualReconciliationRequired"] = unknown or not fixtures_clean or not receipt["registryCleanupSuccess"]
        receipt["success"] = receipt["success"] and not receipt["manualReconciliationRequired"]
        if receipt["manualReconciliationRequired"]:
            receipt["retainedRegistryOwner"] = registry.prefix
        try:
            write_progress(args.output_dir / "session-progress.json", receipt)
        except (OSError, ValueError, TypeError):
            receipt.update(progressPersisted=False, manualReconciliationRequired=True, success=False)
    return receipt


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-native", required=True, action="store_true")
    for name in ("bundle-dir", "web-scratch", "web-build-proof", "web-archive-proof", "output-dir"):
        parser.add_argument("--" + name, type=Path, required=True)
    for name in ("expected-revision", "engine-revision"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--engine-run-id", type=int, required=True)
    for role in SUPPORT:
        parser.add_argument("--" + role.replace("_", "-") + "-image", required=True)
    parser.add_argument("--with-recovery", action="store_true")
    parser.add_argument("--sudo-recovery", action="store_true")
    parser.add_argument("--storage-client-bin", choices=("mc", "mcli"), default="mc")
    for name in ("restic", "pg-control"):
        parser.add_argument("--" + name, type=Path)
        parser.add_argument("--" + name + "-sha256")
    args = parser.parse_args(argv)
    output_created = False
    receipt = None
    try:
        _native_host()
        require(not args.sudo_recovery or args.with_recovery, "Privileged callback requires explicit recovery selection")
        require(args.output_dir.is_absolute() and args.output_dir.parent.resolve(strict=True) == args.output_dir.parent
                and not os.path.lexists(args.output_dir), "Fresh canonical output directory required")
        if args.with_recovery:
            require((args.sudo_recovery or os.geteuid() == 0)
                    and all((args.restic, args.restic_sha256, args.pg_control, args.pg_control_sha256)),
                    "Root or an explicit privileged callback and pinned recovery tools required")
            require(not args.sudo_recovery or os.geteuid() != 0, "Privileged callback must start under the ordinary runner")
        else:
            require(not any((args.restic, args.restic_sha256, args.pg_control, args.pg_control_sha256)),
                    "Recovery tools require explicit recovery selection")
        args.output_dir.mkdir(mode=0o700)
        output_created = True
        docker = IsolatedDocker(args.output_dir / "docker", runner=run_owned_fixture_command)
        roles, revisions, supports, custody = admit_images(GitHub(), docker, args, os.environ, args.output_dir)
        recovery = None
        if args.with_recovery:
            from fresh_compose_recovery_smoke import run as run_recovery

            def recovery(baseline, candidate):
                selected = sudo_recovery if args.sudo_recovery else run_recovery
                return selected(baseline, candidate, restic=args.restic,
                    restic_pin=args.restic_sha256, pg_control=args.pg_control, pg_control_pin=args.pg_control_sha256,
                    output_parent=args.output_dir, storage_client_bin=args.storage_client_bin)
        receipt = {"schemaVersion": 1, "kind": "warpdrive-native-fresh-compose-qualification", "custody": custody,
                   **exercise_session(docker, args, roles, revisions, supports, recovery=recovery)}
        with private_file(args.output_dir / "report.json") as output:
            output.write(json.dumps(receipt, sort_keys=True, allow_nan=False).encode() + b"\n")
        print(json.dumps(receipt, sort_keys=True, allow_nan=False))
        return 0 if receipt["success"] else 1
    except (Exception, KeyboardInterrupt) as error:
        unknown = (isinstance(error, FreshCommandUnknown)
                   or type(receipt) is dict and receipt.get("manualReconciliationRequired") is True
                   or output_created and pending_outcome(args.output_dir))
        receipt = {"state": "held", **failure_fact(error), "nativeExecutionPending": True, "deploymentAuthorized": False,
                   "manualReconciliationRequired": bool(unknown), "mutationOutcomeUnknown": bool(unknown)}
        if output_created and not os.path.lexists(args.output_dir / "report.json"):
            try:
                with private_file(args.output_dir / "report.json") as output:
                    output.write(json.dumps(receipt, sort_keys=True, allow_nan=False).encode() + b"\n")
            except OSError:
                pass
        print(json.dumps(receipt), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(internal_cold_recovery() if sys.argv[1:] == ["--internal-cold-recovery"] else main())
