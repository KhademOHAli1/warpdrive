"""Load the tested rollback Web image from its committed rollout evidence."""

import argparse
from hashlib import sha256
import os
from pathlib import Path
import stat
import sys
import tarfile
from tempfile import TemporaryDirectory
from zipfile import BadZipFile, ZIP_DEFLATED, ZIP_STORED, ZipFile

from candidate import CandidateError, REVISION, require
from component_inputs import HASH, decode
from headless_web_custody import producer_readback, source_pins
from image_smoke import Docker, SmokeError, image_metadata
from publication_gate import GateError, REPO
from web_candidate import ARCHIVE, IMAGE_ID, MAX_ARCHIVE_BYTES, verify_saved_web_image
from web_custody_workflow import number, registry_auth
from web_publication_gate import PublicGitHub, ZipReader, copy_bytes, download, private_file
from web_release_build import git
from web_release_custody import retrieve


ROLLOUT = "docs/deployment-evidence/headless-web-rollout-20261120.json"
MEMBERS = {ARCHIVE: MAX_ARCHIVE_BYTES, "report.json": 256 * 1024,
           "archive.json": 16 * 1024, "SHA256SUMS": 1024}


def retained_pins(root, revision):
    rollout = decode(git(root, "show", f"{revision}:{ROLLOUT}"))
    require(rollout["kind"] == "warpdrive-installed-headless-web-rollout"
            and type(rollout["schemaVersion"]) is int and rollout["schemaVersion"] == 1,
            "Exact installed headless Web rollout evidence required")
    core, web = rollout["core"], rollout["web"]
    require(core["version"] == "1.8.1" and web["version"] == "1.8.2"
            and all(REVISION.fullmatch(row["sourceRevision"]) and IMAGE_ID.fullmatch(row["testedConfigId"])
                    for row in (core, web))
            and len({revision, core["sourceRevision"], web["sourceRevision"]}) == 3
            and core["testedConfigId"] != web["testedConfigId"]
            and HASH.fullmatch(web["imageArtifact"]["archiveSha256"]),
            "Distinct exact retained Core and rollback Web image pins required")
    require(core["sourceRevision"] == os.environ["RETAINED_REVISION"]
            and core["testedConfigId"] == os.environ["RETAINED_CORE_ID"],
            "The rollback Web was tested with a different retained Core")
    (_, pin, job, steps), = (row for row in source_pins(root, revision) if row[0] == "web-1.8.2")
    return core, web, pin, job, steps


def select_transport(api, requested, pin, job, steps):
    if requested == "custody":
        return requested
    repository = api.request(f"repos/{REPO}")
    require(repository.get("full_name") == REPO and number(repository.get("id")),
            "Canonical repository identity required")
    observed = producer_readback(api, repository["id"], pin, job, steps, retaining=requested == "actions")
    return "actions" if observed["actionsArtifact"] == "verified" else "custody"


def extract_web(zip_path, directory, pin, core, web):
    expected = web["imageArtifact"]["archiveSha256"]
    descriptor = os.open(zip_path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with ZipReader(os.fdopen(descriptor, "rb", buffering=0)) as source:
        file = os.fstat(source.fileno())
        require(stat.S_ISREG(file.st_mode) and file.st_size == pin["sizeBytes"], "Rollback ZIP type or size differs")
        # Both authenticated transports have already checked every byte against the committed ZIP digest.
        with ZipFile(source) as package:
            entries = package.infolist()
            require(len(entries) == len(MEMBERS) and {item.filename for item in entries} == set(MEMBERS),
                    "Unexpected rollback Web ZIP inventory")
            for item in entries:
                require(item.orig_filename == item.filename and not item.is_dir()
                        and stat.S_IFMT(item.external_attr >> 16) in (0, stat.S_IFREG)
                        and not (item.flag_bits & 1) and item.compress_type in (ZIP_STORED, ZIP_DEFLATED)
                        and 0 < item.file_size <= MEMBERS[item.filename], "Unsafe rollback Web ZIP member")
            sums = package.read("SHA256SUMS").decode("ascii").splitlines()
            require(len(sums) == 3 and sums[0] == f"{expected}  {ARCHIVE}",
                    "Committed rollback Web archive checksum differs")
            report, archive = (package.read(name) for name in ("report.json", "archive.json"))
            require(sums[1:] == [f"{sha256(report).hexdigest()}  report.json",
                                 f"{sha256(archive).hexdigest()}  archive.json"], "Rollback artifact metadata checksums differ")
            report, archive = decode(report), decode(archive)
            require(report["kind"] == "warpdrive-headless-web-only-image-smoke" and report["schemaVersion"] == 1
                    and report["success"] is True and report["failure"] is None and report["cleanup"]["success"] is True
                    and report["expectedWebVersion"] == web["version"]
                    and report["expectedRevision"] == report["images"]["web"]["revision"] == web["sourceRevision"]
                    and report["images"]["web"]["id"] == web["testedConfigId"]
                    and report["retainedRevision"] == report["coreImage"]["revision"] == core["sourceRevision"]
                    and report["coreImage"]["id"] == core["testedConfigId"], "Rollback Web smoke report differs from its pins")
            size = package.getinfo(ARCHIVE).file_size
            manifest = archive["imageManifestId"]
            require(archive["kind"] == "warpdrive-headless-web-only-archive" and archive["schemaVersion"] == 1
                    and archive["version"] == web["version"] and archive["sourceRevision"] == web["sourceRevision"]
                    and archive["testedConfigId"] == web["testedConfigId"] and archive["archiveSha256"] == expected
                    and archive["archiveSizeBytes"] == size and IMAGE_ID.fullmatch(manifest)
                    and manifest != web["testedConfigId"], "Rollback Web archive metadata differs from its pins")
            source.maximum_read = 1024 * 1024
            with package.open(ARCHIVE) as member, private_file(directory / ARCHIVE) as output:
                require(copy_bytes(member.read, output, size) == expected, "Rollback Web archive checksum differs")
    verified = verify_saved_web_image(directory, expected_image_id=web["testedConfigId"], expected_revision=web["sourceRevision"])
    require(verified["archiveSha256"] == expected and verified["archiveSizeBytes"] == size,
            "Rollback Web archive identity changed during verification")
    with tarfile.open(directory / ARCHIVE, "r:") as docker_archive:
        with docker_archive.extractfile("index.json") as index:
            require(decode(index.read())["manifests"][0]["digest"] == manifest, "Rollback Web OCI manifest differs")


def load_web(runner_temp, transport, oras, pin, core, web):
    with TemporaryDirectory(prefix="headless-rollback-web.", dir=runner_temp) as path:
        directory = Path(path)
        package = directory / "web.zip"
        if transport == "actions":
            download(pin, package)
        else:
            binary = Path(oras)
            require(binary.is_absolute() and binary == binary.resolve(strict=True) and binary.is_file()
                    and binary.name == "oras" and binary.parent.parent == runner_temp
                    and binary.parent.name.startswith("custody-oras."), "Verified private ORAS executable required")
            with registry_auth(runner_temp):
                retrieve(binary, package, kind="archive", digest=pin["digest"], size=pin["sizeBytes"])
        extract_web(package, directory, pin, core, web)
        docker = Docker()
        docker.run(["image", "load", "--platform", "linux/amd64", "--input", str(directory / ARCHIVE)], timeout=300)
        rows = docker.json(["image", "inspect", web["testedConfigId"]], timeout=15)
        require(image_metadata(rows, web["sourceRevision"])["id"] == web["testedConfigId"]
                and rows[0].get("Os") == "linux" and rows[0].get("Architecture") == "amd64",
                "Loaded rollback Web does not match the pinned AMD64 image")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("select", "load"))
    parser.add_argument("transport", choices=("auto", "actions", "custody"))
    args = parser.parse_args()
    try:
        root = Path(os.environ["GITHUB_WORKSPACE"])
        revision = os.environ["SOURCE_REVISION"]
        require(REVISION.fullmatch(revision), "Exact qualification source revision required")
        core, web, pin, job, steps = retained_pins(root, revision)
        if args.operation == "select":
            print(select_transport(PublicGitHub(), args.transport, pin, job, steps))
        else:
            require(args.transport != "auto", "A verified rollback transport must be selected")
            load_web(Path(os.environ["RUNNER_TEMP"]).resolve(strict=True), args.transport,
                     os.environ.get("CUSTODY_ORAS", ""), pin, core, web)
            with Path(os.environ["GITHUB_ENV"]).open("a") as output:
                print(f"BASELINE_WEB_IMAGE={web['testedConfigId']}", file=output)
                print(f"BASELINE_WEB_REVISION={web['sourceRevision']}", file=output)
                print(f"BASELINE_WEB_VERSION={web['version']}", file=output)
    except (BadZipFile, CandidateError, GateError, SmokeError, OSError, RuntimeError,
            ValueError, TypeError, KeyError, AttributeError) as error:
        print(f"Rollback Web input held ({type(error).__name__}): {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
