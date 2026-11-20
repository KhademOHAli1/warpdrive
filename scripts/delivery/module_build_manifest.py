"""Join source-module versions to actual tested producer image identities.

This is a sidecar, not a replacement image bundle, publication or installed
manifest. Native Docker IDs are never assumed to be config/platform digests.
"""
from __future__ import annotations

import argparse
from hashlib import sha256
import json
import os
from pathlib import Path
import stat

import module_versions as versions

ROLES = frozenset({"web", "worker", "realtime", "migrator"})
HEADLESS_ROLES = ROLES | {"core-api"}
MANIFEST_TYPES = frozenset({"application/vnd.oci.image.manifest.v1+json",
                           "application/vnd.docker.distribution.manifest.v2+json"})
MAX_METADATA = 4 * 1024**2


def metadata(path):
    path = Path(path)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as stream:
        before = os.fstat(stream.fileno())
        versions.require(stat.S_ISREG(before.st_mode) and 0 < before.st_size <= MAX_METADATA,
                         "Bounded regular producer metadata required")
        raw = stream.read(MAX_METADATA + 1)
        after = os.fstat(stream.fileno())
    versions.require(len(raw) == before.st_size and
                     (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                     (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns),
                     "Producer metadata changed while reading")
    return versions.decode(raw), {"sha256": sha256(raw).hexdigest(), "bytes": len(raw)}


def join_build(git, revision, release_version, candidate, smoke, inspections, evidence):
    revision = git.revision(revision)
    package = versions.decode(git.blobs(revision, ["package.json"])["package.json"])
    versions.require(package.get("version") == release_version,
                     "Release version must equal the exact committed package version")
    source = versions.manifest(git, revision, release_version)
    headless = type(candidate) is dict and candidate.get("schemaVersion") == 4
    roles = HEADLESS_ROLES if headless else ROLES
    versions.require(type(candidate) is dict and candidate.get("schemaVersion") in {2, 3, 4}
                     and candidate.get("kind") == "warpdrive-image-candidate"
                     and candidate.get("revision") == revision
                     and candidate.get("deploymentAuthorized") is False
                     and type(candidate.get("components")) is dict
                     and set(candidate["components"]) == roles,
                     "Exact unpromoted image candidate required")
    versions.require(type(smoke) is dict and smoke.get("expectedRevision") == revision
                     and smoke.get("success") is True and smoke.get("failure") is None
                     and smoke.get("cleanup", {}).get("success") is True
                     and not smoke["cleanup"].get("errors")
                     and type(smoke.get("images")) is dict and set(smoke["images"]) == ROLES
                     and type(smoke.get("checks")) is list and smoke["checks"]
                     and all(row.get("status") == "passed" for row in smoke["checks"]),
                     "Completed exact producer image smoke and cleanup required")
    smoke_images = smoke["images"]
    if headless:
        versions.require(smoke.get("kind") == "warpdrive-headless-final-image-smoke"
                         and type(smoke.get("coreImage")) is dict, "Headless Core smoke required")
        smoke_images = {**smoke_images, "core-api": smoke["coreImage"]}
    versions.require(set(inspections) == roles and set(evidence) == {"candidate", "smoke", "inspections"}
                     and set(evidence["inspections"]) == roles,
                     "Complete original producer inspection/evidence inventory required")
    built = {}
    for role in sorted(roles):
        rows = inspections[role]
        versions.require(type(rows) is list and len(rows) == 1 and type(rows[0]) is dict,
                         "One original inspection per built module required")
        row = rows[0]
        identity = candidate["components"][role].get("imageId")
        versions.require(type(identity) is str and versions.DIGEST.fullmatch(identity)
                         and row.get("Id") == identity == smoke_images[role].get("id")
                         and smoke_images[role].get("revision") == revision
                         and candidate["components"][role].get("sourceRevision", revision) == revision
                         and row.get("Config", {}).get("Labels", {}).get("org.opencontainers.image.revision") == revision,
                         "Candidate, smoke, inspection and source identity differ")
        descriptor = row.get("Descriptor")
        platform = None
        if type(descriptor) is dict and descriptor.get("mediaType") in MANIFEST_TYPES:
            versions.require(type(descriptor.get("digest")) is str and versions.DIGEST.fullmatch(descriptor["digest"]),
                             "Image descriptor digest is invalid")
            # Docker storage backends may expose different native and descriptor
            # identities. This join has no archive graph to prove that mapping.
            # Keep the platform identity unknown unless it is the tested ID.
            if descriptor["digest"] == identity:
                platform = identity
        built[role] = {"sourceModuleVersion": source["modules"][role]["sourceModuleVersion"],
                       "sourceRevision": revision, "testedNativeImageId": identity,
                       "platformManifestDigest": platform, "configDigest": None,
                       "installedModuleVersion": None, "installedRuntimeId": None,
                       "evidence": {"candidate": evidence["candidate"], "smoke": evidence["smoke"],
                                    "inspection": evidence["inspections"][role]}}
    return {"schemaVersion": 1, "kind": "warpdrive-tested-module-build-manifest",
            "releaseVersion": release_version, "sourceRevision": revision, "sourceManifest": source,
            "builtModules": built,
            "identityScope": "Original producer candidate/smoke/inspection join. Native IDs retain their type; unavailable config/platform identities remain null.",
            "authenticationScope": "Consumer must authenticate the original workflow and artifact; this sidecar does not authenticate itself.",
            "installedAcceptance": False, "publicationAuthorized": False, "deploymentAuthorized": False}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    parser.add_argument("--revision", required=True)
    parser.add_argument("--release-version", required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--smoke-report", type=Path, required=True)
    parser.add_argument("--inspections", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    candidate, candidate_pin = metadata(args.candidate)
    smoke, smoke_pin = metadata(args.smoke_report)
    inspections, pins = {}, {}
    roles = HEADLESS_ROLES if type(candidate) is dict and candidate.get("schemaVersion") == 4 else ROLES
    for role in sorted(roles):
        inspections[role], pins[role] = metadata(args.inspections / (role + ".json"))
    result = join_build(versions.Git(args.repo), args.revision, args.release_version, candidate, smoke,
                        inspections, {"candidate": candidate_pin, "smoke": smoke_pin, "inspections": pins})
    with args.output.open("xb") as stream:
        stream.write(versions.canonical(result))
    print(json.dumps({"output": str(args.output), "releaseVersion": result["releaseVersion"],
                      "builtModules": sorted(result["builtModules"]), "deploymentAuthorized": False}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
