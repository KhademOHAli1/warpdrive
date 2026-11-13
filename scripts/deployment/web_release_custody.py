"""Store and retrieve admitted release bytes by content digest in an OCI registry."""

import argparse
from contextlib import contextmanager
from hashlib import file_digest, sha256
import os
from pathlib import Path
import subprocess
import sys
from urllib.parse import urlencode
from urllib.request import ProxyHandler, build_opener

from candidate import CandidateError, IMAGE_ID, require
from component_inputs import canonical
from publication_gate import MAX_ZIP_BYTES, REPO
from web_candidate import _directory, _opened
from web_publication_gate import bounded_read, copy_bytes, private_file
from web_release_build import private_destination, write_metadata


REPOSITORY = f"ghcr.io/{REPO.lower()}-release-custody"
OCI_MANIFEST = "application/vnd.oci.image.manifest.v1+json"
OCI_EMPTY = "application/vnd.oci.empty.v1+json"
ARTIFACT_TYPE = "application/vnd.warpdrive.release-custody.v1"
MEDIA = {"archive": "application/zip", "receipt": "application/json"}
MAX_RECEIPT_BYTES = 1024 * 1024


def custody_manifest(kind, digest, size):
    """Derive the immutable reference from pre-existing authenticated evidence."""
    require(kind in MEDIA and isinstance(digest, str) and IMAGE_ID.fullmatch(digest)
            and type(size) is int and 0 < size <= (MAX_ZIP_BYTES if kind == "archive" else MAX_RECEIPT_BYTES),
            "An admitted custody digest, size and media type are required")
    return canonical({
        "schemaVersion": 2,
        "mediaType": OCI_MANIFEST,
        "artifactType": ARTIFACT_TYPE,
        "config": {"mediaType": OCI_EMPTY, "digest": "sha256:" + sha256(b"{}").hexdigest(), "size": 2},
        "layers": [{"mediaType": MEDIA[kind], "digest": digest, "size": size}],
        "annotations": {"org.opencontainers.image.source": f"https://github.com/{REPO}"},
    })


def manifest_digest(raw):
    return "sha256:" + sha256(raw).hexdigest()


@contextmanager
def verified_bytes(path, kind, digest, size):
    """Hold a stable, independently pinned local source for the duration of a copy."""
    custody_manifest(kind, digest, size)
    with _directory(path.parent) as parent, _opened(parent, path.name, size) as (source, actual_size):
        require(actual_size == size and "sha256:" + file_digest(source, "sha256").hexdigest() == digest,
                "Retained source differs from its admitted bytes")
        source.seek(0)
        yield source


def prepare_layout(path, source_path, *, kind, digest, size):
    """Stage an OCI layout using the exact authenticated bytes and a deterministic manifest."""
    private_destination(path, source_path.parent)
    raw = custody_manifest(kind, digest, size)
    immutable = manifest_digest(raw)
    with verified_bytes(source_path, kind, digest, size) as source:
        blobs = path / "blobs/sha256"
        path.mkdir(mode=0o700)
        blobs.mkdir(parents=True, mode=0o700)
        with private_file(blobs / digest.removeprefix("sha256:")) as output:
            require("sha256:" + copy_bytes(source.read, output, size) == digest,
                    "Staged custody payload differs")
            output.flush()
            os.fsync(output.fileno())
        for payload, pin in ((raw, immutable), (b"{}", manifest_digest(b"{}"))):
            with private_file(blobs / pin.removeprefix("sha256:")) as output:
                output.write(payload)
                output.flush()
                os.fsync(output.fileno())
        write_metadata(path / "oci-layout", {"imageLayoutVersion": "1.0.0"})
        write_metadata(path / "index.json", {"schemaVersion": 2, "manifests": [{
            "mediaType": OCI_MANIFEST, "artifactType": ARTIFACT_TYPE, "digest": immutable,
            "size": len(raw), "annotations": {"org.opencontainers.image.ref.name": "custody"},
        }]})
    return immutable


def _fetch_manifest(oras, target, *, layout=False):
    command = [str(oras), "manifest", "fetch", *(["--oci-layout"] if layout else []), target]
    with subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL) as source:
        try:
            read = bounded_read(source.stdout, timeout_seconds=30)
            raw = bytearray()
            while chunk := read(4097 - len(raw)):
                raw.extend(chunk)
                require(len(raw) <= 4096, "OCI custody manifest exceeds its byte budget")
            return source.wait(timeout=5), bytes(raw)
        finally:
            if source.poll() is None:
                source.kill()
                source.wait(timeout=5)


def _target(layout, digest):
    if layout is not None:
        return f"{layout}@{digest}"
    return f"{REPOSITORY}@{digest}"


def _finish(partial, destination):
    os.link(partial, destination, follow_symlinks=False)
    partial.unlink()
    descriptor = os.open(destination.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _fetch_payload(oras, digest, size, *, layout, output):
    command = [str(oras), "blob", "fetch", "--output", "-", *(["--oci-layout"] if layout else []),
               _target(layout, digest)]
    with subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL) as source:
        try:
            read = bounded_read(source.stdout, timeout_seconds=600)
            require("sha256:" + copy_bytes(read, output, size) == digest and source.wait(timeout=10) == 0,
                    "Retrieved custody payload differs from the admitted bytes")
        finally:
            if source.poll() is None:
                source.kill()
                source.wait(timeout=5)


def _verify_anonymous_denied(immutable):
    # Before write this detects an already public package. After write it
    # confirms the exact digest is accessible only with registry credentials.
    from registry_absence import _NoRedirect, _get, _json, _scope

    repository = REPOSITORY.split("/", 1)[1]
    url = f"https://ghcr.io/v2/{repository}/manifests/{immutable}"
    transport = build_opener(ProxyHandler({}), _NoRedirect())
    status, headers, _ = _get(transport, url, {"Accept": OCI_MANIFEST})
    challenges = headers.get_all("WWW-Authenticate") or []
    require(status == 401 and len(challenges) == 1
            and _scope(challenges[0], repository) == f"repository:{repository}:pull",
            "The retained release digest is not proven to require authentication")
    token_url = "https://ghcr.io/token?" + urlencode({"service": "ghcr.io", "scope": f"repository:{repository}:pull"})
    token_status, _, raw = _get(transport, token_url, {"Accept": "application/json"})
    errors = _json(raw).get("errors", [])
    require(token_status == 403 and len(errors) == 1 and errors[0].get("code") == "DENIED",
            "Anonymous GHCR pull authorization was not explicitly denied")


def retrieve(oras, destination, *, kind, digest, size, layout=None):
    """Read by digest and verify bytes before handing an archive to its original verifier."""
    private_destination(destination)
    raw = custody_manifest(kind, digest, size)
    immutable = manifest_digest(raw)
    require(_fetch_manifest(oras, _target(layout, immutable), layout=layout is not None) == (0, raw),
            "Immutable OCI custody manifest differs or is unavailable")
    partial = destination.with_name(destination.name + ".partial")
    with private_file(partial) as output:
        _fetch_payload(oras, digest, size, layout=layout, output=output)
        output.flush()
        os.fsync(output.fileno())
    _finish(partial, destination)
    return immutable


def publish(oras, path, source_path, *, kind, digest, size, observe_only=False):
    """Copy a verified layout once, then verify the tag, manifest and full remote payload."""
    from registry_absence import confirm_absent

    raw = custody_manifest(kind, digest, size)
    immutable = manifest_digest(raw)
    tagged = f"{REPOSITORY}:{immutable.replace(':', '-')}"
    status, observed = _fetch_manifest(oras, tagged)
    if status != 0:
        require(not observe_only and not os.path.lexists(path),
                "Publication is unresolved; immutable tag was not observed")
        _verify_anonymous_denied(immutable)
        confirm_absent(tagged, environment=dict(os.environ))
        require(prepare_layout(path, source_path, kind=kind, digest=digest, size=size) == immutable,
                "Prepared custody manifest differs")
        write_metadata(path / "publication-intent.json", {"tag": tagged, "manifestDigest": immutable})
        result = subprocess.run([str(oras), "cp", "--from-oci-layout", f"{path}:custody", tagged],
                                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                check=False, timeout=900)
        require(result.returncode == 0, "Custody write outcome is unresolved; use observe-only for readback")
        status, observed = _fetch_manifest(oras, tagged)
    require(status == 0 and observed == raw and _fetch_manifest(oras, _target(None, immutable)) == (0, raw),
            "Published custody tag and immutable manifest differ")
    with open(os.devnull, "wb") as discard:
        _fetch_payload(oras, digest, size, layout=None, output=discard)
    _verify_anonymous_denied(immutable)
    return immutable


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("retrieve", "publish", "observe"))
    parser.add_argument("--oras", required=True, type=Path)
    parser.add_argument("--path", required=True, type=Path)
    parser.add_argument("--source", type=Path)
    parser.add_argument("--kind", choices=tuple(MEDIA), required=True)
    parser.add_argument("--digest", required=True)
    parser.add_argument("--size", type=int, required=True)
    args = parser.parse_args(argv)
    options = {"kind": args.kind, "digest": args.digest, "size": args.size}
    try:
        if args.action == "retrieve":
            result = retrieve(args.oras, args.path, **options)
        else:
            require(args.source is not None or args.action == "observe", "Admitted publication source required")
            result = publish(args.oras, args.path, args.source, observe_only=args.action == "observe", **options)
    except (CandidateError, OSError, RuntimeError, TypeError, AttributeError, subprocess.SubprocessError) as error:
        print(f"Release custody held ({type(error).__name__}): {error}", file=sys.stderr)
        return 1
    print(f"{REPOSITORY}@{result}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
