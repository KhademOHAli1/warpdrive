#!/usr/bin/env python3
"""Qualify an already-built final Linux engine image on owned local Docker only.

No builds, publication, source mounts, inherited provider credentials or deployment.
Native migration contract functions run through actual final-image containers.
"""
from __future__ import annotations

import argparse
import base64
from contextlib import ExitStack, contextmanager
import gzip
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import re
import secrets
import signal
import shutil
import stat
import subprocess
import struct
import sys
import tarfile
import tempfile
import time
from types import SimpleNamespace
import uuid
import zlib

try:
    from .image_smoke import ImageSmoke, OWNER_LABEL, SmokeError, validate_reference, validate_revision, utc_now
    from .registry_smoke import IsolatedDocker
except ImportError:
    from image_smoke import ImageSmoke, OWNER_LABEL, SmokeError, validate_reference, validate_revision, utc_now
    from registry_smoke import IsolatedDocker

REPO = Path(__file__).resolve().parents[2]
CONTEXT = REPO / "deploy/newsletters/engine"
UPSTREAM_SHA = "52119464c87ed71a60d46f7097ddb304967d344fc1954769388a1e2d764b659b"
UPSTREAM_SOURCE = "https://github.com/knadh/listmonk/tree/ef0a75872463f10a4848af6c547d1c057405453a"
CONTEXT_LABEL = "io.warpdrive.engine.context.sha256"
OLD_REVISION = "35c40339b8068a489247080e61430d17bfbfdb26"
OLD_TREE = "72c4eb357e6981315909fb134c021f1c5eaa2025"
OLD_CONTEXT_SHA = "1e935b4f2ad94158db9cb3482f2fa874d90e80a289bb65099991a79769b92626"
LIMITATIONS = [
    "Disposable Linux/amd64 final-image fixture only; no production deployment or existing-volume ownership transition.",
    "Historical packed upgrade is synthetic baseline35c40339 only; it does not qualify an actual installed VPS or arbitrary older versions.",
    "No external SMTP/provider delivery, public ingress, backup restore or installed monitoring qualification.",
    "Advisory lifecycle locks are cooperative; supported DDL still requires independently verified offline maintenance.",
]
REQUIRED_CHECKS = (
    "immutable-final-engine-image", "owned-internal-fixture", "actual-final-image-packaging",
    "empty-runtime-refuses-schema-writes", "file-secret-loader-and-fresh-install", "fresh-repeat-no-write-migration", "pinned-schema-legacy-holds",
    "explicit-upgrade-and-no-write", "receipt-and-index-drift-rejection", "restricted-role-no-ddl-startup",
    "rls-policy-sequence-drift-rejection", "runtime-excludes-migration", "migration-excludes-actual-runtime",
    "fence-loss-exits-and-restarts", "final-image-health-and-readiness",
    "supported-old-packed-binary-upgrade",
)


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def valid_media_path(path: str) -> bool:
    return (isinstance(path, str) and re.fullmatch(r"/listmonk/uploads(?:/[A-Za-z0-9_.-]{1,200}){0,2}", path) is not None
            and not any(part in {".", ".."} for part in Path(path).parts))


def preserved_rows(before: dict, after: dict, *, added_receipt: bool = False) -> bool:
    old = {key: value for key, value in before.items() if key.startswith("table:")}
    new = {key: value for key, value in after.items() if key.startswith("table:")}
    expected = set(old) | ({"table:warpdrive_engine_schema"} if added_receipt else set())
    return bool(old) and set(new) == expected and all(new.get(key) == value for key, value in old.items())


def png_chunk(kind, payload):
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload))


UPGRADE_PNG = (b"\x89PNG\r\n\x1a\n" + png_chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
               + png_chunk(b"IDAT", zlib.compress(b"\x00\x30\x70\x90")) + png_chunk(b"IEND", b""))
MEDIA_REQUEST_LIMIT = 8192
MEDIA_RESPONSE_LIMIT = 16384
MEDIA_HEADER_LIMIT = 4096
MEDIA_BODY_LIMIT = 8192


def media_upload_request(authorization, boundary):
    if (not isinstance(authorization, str) or len(authorization) > 2048
            or re.fullmatch(r"Basic [A-Za-z0-9+/]+={0,2}", authorization) is None
            or not isinstance(boundary, str) or re.fullmatch(r"engine-upgrade-[a-f0-9]{24}", boundary) is None):
        raise SmokeError("Historical media request headers are invalid")
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="fixture.png"\r\n'
            'Content-Type: image/png\r\n\r\n').encode("ascii") + UPGRADE_PNG + f"\r\n--{boundary}--\r\n".encode("ascii")
    header = ("POST /api/media HTTP/1.1\r\nHost: 127.0.0.1:9000\r\nConnection: close\r\n"
              "Accept: application/json\r\nAuthorization: " + authorization
              + "\r\nContent-Type: multipart/form-data; boundary=" + boundary
              + f"\r\nContent-Length: {len(body)}\r\n\r\n").encode("ascii")
    request = header + body
    if len(request) > MEDIA_REQUEST_LIMIT:
        raise SmokeError("Historical media request exceeds the synthetic fixture bound")
    return request


def parse_media_http_response(raw):
    """Decode one finite HTTP/1.x response, without retaining arbitrary response text."""
    def invalid():
        raise SmokeError("Historical media HTTP response is invalid or ambiguous")
    if not isinstance(raw, bytes) or not raw or len(raw) > MEDIA_RESPONSE_LIMIT:
        invalid()
    end = raw.find(b"\r\n\r\n")
    if end < 0 or end > MEDIA_HEADER_LIMIT:
        invalid()
    lines = raw[:end].split(b"\r\n")
    status = re.fullmatch(rb"HTTP/1\.[01] ([1-5][0-9]{2})(?: [\x20-\x7e]*)?", lines[0])
    if status is None or len(lines) > 65:
        invalid()
    headers = {}
    for line in lines[1:]:
        name, colon, value = line.partition(b":")
        if (not colon or re.fullmatch(rb"[!#$%&'*+.^_`|~0-9A-Za-z-]+", name) is None
                or any(char < 32 and char != 9 or char > 126 for char in value)):
            invalid()
        name = name.lower()
        if name in {b"content-length", b"transfer-encoding"} and name in headers:
            invalid()
        headers[name] = value.strip(b" \t")
    body = raw[end + 4:]
    length, transfer = headers.get(b"content-length"), headers.get(b"transfer-encoding")
    if length is not None and transfer is not None:
        invalid()
    if transfer is not None:
        if transfer.lower() != b"chunked":
            invalid()
        decoded, position = bytearray(), 0
        for _ in range(128):
            line_end = body.find(b"\r\n", position)
            size = body[position:line_end] if line_end >= position else b""
            # Chunk extensions/trailers are unnecessary for this fixed JSON API.
            if re.fullmatch(rb"[0-9A-Fa-f]{1,8}", size) is None:
                invalid()
            count = int(size, 16)
            position = line_end + 2
            if count == 0:
                if body[position:] != b"\r\n":
                    invalid()
                return int(status[1]), bytes(decoded)
            if len(decoded) + count > MEDIA_BODY_LIMIT or body[position + count:position + count + 2] != b"\r\n":
                invalid()
            decoded.extend(body[position:position + count])
            position += count + 2
        invalid()
    if (length is None or re.fullmatch(rb"0|[1-9][0-9]{0,5}", length) is None
            or int(length) > MEDIA_BODY_LIMIT or len(body) != int(length)):
        invalid()
    return int(status[1]), body

OLD_INITIAL_SEED = """
UPDATE settings SET value='false'::jsonb WHERE key IN ('app.check_updates','app.cache_slow_queries','maintenance.db.vacuum');
UPDATE settings SET value='\"/listmonk/uploads\"'::jsonb WHERE key='upload.filesystem.upload_path';
UPDATE settings SET value=jsonb_set(jsonb_set(value,'{0,host}','\"127.0.0.1\"'),'{0,port}','1') WHERE key='smtp';
INSERT INTO campaigns(id,uuid,name,subject,from_email,body,status,messenger,sent,started_at,last_subscriber_id,max_subscriber_id,to_send)
VALUES(999,gen_random_uuid(),'Old packed legacy cursor','Synthetic','sender@example.test','Synthetic','running','email',1,clock_timestamp(),7,9203,2);
"""

OLD_WITNESSES = """
INSERT INTO lists(id,uuid,name,type,optin) VALUES(9101,gen_random_uuid(),'Synthetic upgrade purpose','private','double');
INSERT INTO subscribers(id,uuid,email,name,status) VALUES
 (9201,'00000000-0000-4000-8000-000000009201','upgrade-active@example.test','Synthetic active','enabled'),
 (9202,'00000000-0000-4000-8000-000000009202','upgrade-blocked@example.test','Synthetic blocked','enabled'),
 (9203,'00000000-0000-4000-8000-000000009203','upgrade-rejected@example.test','Synthetic rejected','enabled');
INSERT INTO subscriber_lists(subscriber_id,list_id,status) VALUES(9201,9101,'confirmed'),(9202,9101,'confirmed');
INSERT INTO warpdrive_crm_identity_challenges(challenge_uuid,binding_uuid,purpose,subscriber_id,subscriber_uuid,email,token_digest,expires_at,verified_at) VALUES
 ('00000000-0000-4000-8000-000000009301','00000000-0000-4000-8000-000000009301','identity',9201,'00000000-0000-4000-8000-000000009201','upgrade-active@example.test',decode(repeat('ab',32),'hex'),clock_timestamp()+interval '1 hour',clock_timestamp()),
 ('00000000-0000-4000-8000-000000009302','00000000-0000-4000-8000-000000009302','identity',9202,'00000000-0000-4000-8000-000000009202','upgrade-blocked@example.test',decode(repeat('ab',32),'hex'),clock_timestamp()+interval '1 hour',clock_timestamp());
INSERT INTO warpdrive_crm_consent_grants(grant_uuid,binding_uuid,subscriber_id,subscriber_uuid,email,purpose_list_id,granted_at) VALUES
 ('00000000-0000-4000-8000-000000009401','00000000-0000-4000-8000-000000009301',9201,'00000000-0000-4000-8000-000000009201','upgrade-active@example.test',9101,clock_timestamp()),
 ('00000000-0000-4000-8000-000000009402','00000000-0000-4000-8000-000000009302',9202,'00000000-0000-4000-8000-000000009202','upgrade-blocked@example.test',9101,clock_timestamp());
UPDATE subscriber_lists SET status='unsubscribed' WHERE subscriber_id=9202 AND list_id=9101;
UPDATE subscribers SET status='blocklisted' WHERE id=9202;
INSERT INTO warpdrive_crm_suppressions(address_digest) VALUES(warpdrive_crm_address_digest('upgrade-erased@example.test'));
INSERT INTO campaigns(id,uuid,name,subject,from_email,body,status,messenger,sent,started_at,last_subscriber_id,max_subscriber_id,to_send)
VALUES(9301,gen_random_uuid(),'Durable upgrade witnesses','Synthetic','sender@example.test','Synthetic','paused','email',0,clock_timestamp(),9202,9203,3);
INSERT INTO warpdrive_delivery_runs(campaign_id,recipient_ceiling,exhausted) VALUES(9301,9203,true);
INSERT INTO warpdrive_delivery_recipients(id,campaign_id,subscriber_id,subscriber_uuid,address_digest,state,attempts,message_id)
 SELECT '00000000-0000-4000-8000-000000009501',9301,id,uuid,sha256(convert_to(email,'UTF8')),'pending',0,NULL FROM subscribers WHERE id=9201;
INSERT INTO warpdrive_delivery_recipients(id,campaign_id,subscriber_id,subscriber_uuid,address_digest,state,attempts,message_id)
 SELECT '00000000-0000-4000-8000-000000009502',9301,id,uuid,sha256(convert_to(email,'UTF8')),'unknown',1,'<upgrade-unknown@example.test>' FROM subscribers WHERE id=9202;
INSERT INTO warpdrive_delivery_recipients(id,campaign_id,subscriber_id,subscriber_uuid,address_digest,state,attempts,message_id)
 SELECT '00000000-0000-4000-8000-000000009503',9301,id,uuid,sha256(convert_to(email,'UTF8')),'rejected',1,'<upgrade-rejected@example.test>' FROM subscribers WHERE id=9203;
UPDATE warpdrive_operational_events SET acknowledged_at=clock_timestamp() WHERE kind='delivery.failed';
"""

OLD_WITNESS_CHECK = """SELECT
 (SELECT status='paused' AND sent=1 AND last_subscriber_id=7 FROM campaigns WHERE id=999)
 AND (SELECT hold='legacy' FROM warpdrive_delivery_runs WHERE campaign_id=999)
 AND (SELECT count(*)=5 FROM warpdrive_delivery_migrations WHERE version IN(1,2,3,4,5))
 AND (SELECT count(*)=1 FROM warpdrive_crm_consent_grants WHERE subscriber_id=9201 AND revoked_at IS NULL)
 AND (SELECT count(*)=1 FROM warpdrive_crm_consent_grants WHERE subscriber_id=9202 AND revoked_at IS NOT NULL)
 AND (SELECT count(*)=1 FROM warpdrive_crm_consent_events WHERE grant_uuid='00000000-0000-4000-8000-000000009402')
 AND EXISTS(SELECT 1 FROM warpdrive_crm_suppressions WHERE address_digest=warpdrive_crm_address_digest('upgrade-erased@example.test'))
 AND (SELECT count(*)=1 FROM warpdrive_delivery_recipients WHERE state='pending' AND attempts=0 AND lease_token IS NULL AND lease_until IS NULL AND subscriber_id=9201)
 AND (SELECT count(*)=1 FROM warpdrive_delivery_recipients WHERE state='unknown' AND attempts=1 AND message_id='<upgrade-unknown@example.test>' AND lease_token IS NULL AND lease_until IS NULL AND subscriber_id=9202)
 AND (SELECT count(*)=1 FROM warpdrive_operational_events WHERE kind='delivery.uncertain' AND acknowledged_at IS NULL AND event_key=digest('delivery:00000000-0000-4000-8000-000000009502:delivery.uncertain','sha256'))
 AND (SELECT count(*)=1 FROM warpdrive_operational_events WHERE kind='delivery.failed' AND acknowledged_at IS NOT NULL AND event_key=digest('delivery:00000000-0000-4000-8000-000000009503:delivery.failed','sha256'))
"""


def required_checks_passed(checks) -> bool:
    return (isinstance(checks, list)
            and all(isinstance(item, dict) and item.get("status") == "passed" for item in checks)
            and tuple(item.get("name") for item in checks) == REQUIRED_CHECKS)


def admit_native_platform(system: str, machine: str, daemon) -> None:
    if (system != "Linux" or machine.lower() not in {"x86_64", "amd64"}
            or not isinstance(daemon, dict) or daemon.get("os") != "linux"
            or str(daemon.get("architecture", "")).lower() not in {"x86_64", "amd64"}):
        raise SmokeError("Engine qualification requires native Linux/amd64 host and Docker daemon")


def admit_secret_tmpfs(root: Path = Path("/dev/shm"), mountinfo: Path = Path("/proc/self/mountinfo")) -> Path:
    """Require the actual Linux tmpfs mount; never fall back to a disk temp directory."""
    try:
        if root.is_symlink():
            raise OSError("symbolic mount root")
        selected = root.resolve(strict=True)
        metadata = selected.stat()
        if not stat.S_ISDIR(metadata.st_mode):
            raise OSError("not a directory")
        with mountinfo.open("rb") as source:
            raw = source.read(256 * 1024 + 1)
        if len(raw) > 256 * 1024:
            raise OSError("mount table bound")
        matches = []
        for line in raw.decode("utf-8").splitlines():
            before, separator, after = line.partition(" - ")
            fields, filesystem = before.split(), after.split()
            if not separator or len(fields) < 6 or len(filesystem) < 3:
                raise OSError("invalid mount table")
            mountpoint = re.sub(r"\\([0-7]{3})", lambda match: chr(int(match[1], 8)), fields[4])
            if mountpoint == str(selected):
                matches.append((fields[2], fields[5].split(","), filesystem[0]))
        device = f"{os.major(metadata.st_dev)}:{os.minor(metadata.st_dev)}"
        if len(matches) != 1 or matches[0][0] != device or "rw" not in matches[0][1] or matches[0][2] != "tmpfs":
            raise OSError("unsupported secret backing")
        return selected
    except (OSError, ValueError, UnicodeError):
        raise SmokeError("Synthetic file-secret fixture requires an admitted writable host tmpfs") from None


def write_synthetic_secret(directory: Path, password: str) -> Path:
    """Preserve the real plaintext _FILE contract inside a private, admitted fixture."""
    directory = Path(directory)
    if (not directory.is_absolute() or len(directory.parts) > 128
            or any(part == ".." for part in directory.parts)):
        raise SmokeError("Synthetic file-secret directory path is not admitted")
    metadata = directory.lstat()
    if (not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != os.geteuid()
            or stat.S_IMODE(metadata.st_mode) != 0o700):
        raise SmokeError("Synthetic file-secret directory is not private")
    target = directory / "db-password"
    def identity(value):
        return value.st_dev, value.st_ino
    directory_flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
    with ExitStack() as held:
        parent = os.open(directory.anchor, directory_flags)
        held.callback(os.close, parent)
        lineage = []
        for part in directory.parts[1:]:
            named = os.stat(part, dir_fd=parent, follow_symlinks=False)
            if not stat.S_ISDIR(named.st_mode):
                raise SmokeError("Synthetic file-secret ancestor is not a real directory")
            descriptor = os.open(part, directory_flags, dir_fd=parent)
            held.callback(os.close, descriptor)
            opened = os.fstat(descriptor)
            if not stat.S_ISDIR(opened.st_mode) or identity(opened) != identity(named):
                raise SmokeError("Synthetic file-secret ancestor authority changed")
            lineage.append((parent, part, descriptor, opened))
            parent = descriptor

        def directory_authority():
            for ancestor, name, descriptor, witnessed in lineage:
                opened = os.fstat(descriptor)
                named = os.stat(name, dir_fd=ancestor, follow_symlinks=False)
                if (not stat.S_ISDIR(opened.st_mode) or not stat.S_ISDIR(named.st_mode)
                        or identity(opened) != identity(witnessed) or identity(named) != identity(witnessed)):
                    raise SmokeError("Synthetic file-secret directory authority changed")
            private = os.fstat(parent)
            if (identity(private) != identity(metadata) or private.st_uid != os.geteuid()
                    or stat.S_IMODE(private.st_mode) != 0o700):
                raise SmokeError("Synthetic file-secret private directory authority changed")

        def inode_authority(descriptor, created, mode):
            opened = os.fstat(descriptor)
            named = os.stat("db-password", dir_fd=parent, follow_symlinks=False)
            for observed in (opened, named):
                if (not stat.S_ISREG(observed.st_mode) or observed.st_uid != os.geteuid()
                        or observed.st_nlink != 1 or stat.S_IMODE(observed.st_mode) != mode
                        or identity(observed) != identity(created)):
                    raise SmokeError("Synthetic file-secret inode authority changed")

        directory_authority()
        descriptor, created, complete = None, None, False
        try:
            # All ancestors stay open. Exclusive descriptor-relative creation can
            # neither traverse a replaced parent nor overwrite an existing leaf.
            descriptor = os.open("db-password", os.O_WRONLY | os.O_CREAT | os.O_EXCL
                                 | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=parent)
            created = os.fstat(descriptor)
            # Keep explicit descriptor ownership until the text wrapper has
            # closed, so close/flush failures still clean only our created inode.
            payload = os.fdopen(descriptor, "w", encoding="utf-8", closefd=False)
            with payload:
                directory_authority()
                inode_authority(payload.fileno(), created, 0o600)
                # Generated-only native fixture; the real _FILE test requires these bytes.
                # Scope/pin review: docs/deployment-evidence/fixture-codeql-exception-20261112.json
                payload.write(password)
                payload.flush()
                os.fchmod(payload.fileno(), 0o444)
                directory_authority()
                inode_authority(payload.fileno(), created, 0o444)
            directory_authority()
            inode_authority(descriptor, created, 0o444)
            complete = True
            return target
        finally:
            try:
                if not complete and created is not None and descriptor is not None:
                    try:
                        remaining = os.stat("db-password", dir_fd=parent, follow_symlinks=False)
                        opened = os.fstat(descriptor)
                        if (stat.S_ISREG(remaining.st_mode) and remaining.st_uid == os.geteuid()
                                and identity(remaining) == identity(created) == identity(opened)):
                            os.unlink("db-password", dir_fd=parent)
                    except FileNotFoundError:
                        pass
            finally:
                if descriptor is not None:
                    os.close(descriptor)


class ExpandedTarReader:
    """Cap decompressed bytes even before tarfile parses extended/PAX headers."""
    def __init__(self, stream, limit):
        self.stream, self.limit, self.seen = stream, limit, 0

    def read(self, size=-1):
        remaining = self.limit - self.seen
        size = remaining + 1 if size < 0 else min(size, remaining + 1)
        data = self.stream.read(size)
        self.seen += len(data)
        if self.seen > self.limit:
            raise SmokeError("Engine source archive expanded-byte bound exceeded")
        return data


@contextmanager
def bounded_tar(path: Path, payload_limit: int, member_limit: int):
    # Header overhead is bounded as well as regular file bodies. Stream mode and
    # immediate iteration prevent unbounded TarInfo caching before admission.
    with gzip.open(path, "rb") as expanded:
        reader = ExpandedTarReader(expanded, payload_limit + member_limit * 4096 + 51200)
        with tarfile.open(fileobj=reader, mode="r|") as archive:
            yield archive


def context_record(context: Path = CONTEXT, *, legacy: bool = False) -> dict:
    files = {}
    total = 0
    for path in sorted(context.rglob("*")):
        if path.is_symlink():
            raise SmokeError("Engine context symlinks are unsupported")
        if not path.is_file():
            continue
        relative = path.relative_to(context).as_posix()
        if "__pycache__" in path.parts or path.name.startswith(".env") or path.suffix == ".pyc":
            raise SmokeError("Engine context contains an unqualified generated/secret file")
        total += path.stat().st_size
        if path.stat().st_size > 2 * 1024**2 or total > 8 * 1024**2 or len(files) >= 256:
            raise SmokeError("Engine build context exceeds its reviewed resource bound")
        files[relative] = digest(path.read_bytes())
    required = ({"Dockerfile", "build.sh", "patches/085-inapp-operational-events.patch"} if legacy else
                {"Dockerfile", "build.sh", "nonroot-entrypoint.sh", "patches/090-explicit-migrations.patch",
                 "migration-tests/verify.py", "migration-tests/test_verify.py"})
    if not required <= files.keys():
        raise SmokeError("Engine context is missing required migration/nonroot inputs")
    encoded = json.dumps(files, sort_keys=True, separators=(",", ":")).encode()
    value = {"sha256": digest(encoded), "files": files}
    if legacy and (len(files) != 39 or value["sha256"] != OLD_CONTEXT_SHA):
        raise SmokeError("Historical engine context does not match the reviewed39-file baseline")
    return value


def prepare_old_context(checkout: Path, output: Path) -> dict:
    """Materialize only verified historical blobs; never execute historical code."""
    def git(*args):
        result = subprocess.run(["git", "--no-replace-objects", "-C", str(checkout), *args],
                                capture_output=True, timeout=15, check=False)
        if result.returncode:
            raise SmokeError("Historical engine Git source verification failed")
        return result.stdout
    if git("rev-parse", "HEAD").decode().strip() != OLD_REVISION:
        raise SmokeError("Historical checkout must identify its original pinned revision")
    commit = git("cat-file", "commit", OLD_REVISION)
    if hashlib.sha1(b"commit " + str(len(commit)).encode() + b"\0" + commit).hexdigest() != OLD_REVISION:
        raise SmokeError("Historical Git commit object differs from pinned identity")
    if git("rev-parse", OLD_REVISION + ":deploy/newsletters/engine").decode().strip() != OLD_TREE:
        raise SmokeError("Historical engine Git tree differs from reviewed baseline")
    prefix = "deploy/newsletters/engine/"
    records = git("ls-tree", "-rz", OLD_REVISION, "--", prefix).split(b"\0")
    if len([row for row in records if row]) != 39:
        raise SmokeError("Historical engine Git source has unexpected file count")
    output.mkdir(parents=True, exist_ok=False)
    try:
        for row in records:
            if not row:
                continue
            header, raw_name = row.split(b"\t", 1)
            mode, kind, oid = header.split()
            name = raw_name.decode()
            if kind != b"blob" or mode not in {b"100644", b"100755"} or not name.startswith(prefix):
                raise SmokeError("Historical context contains an unsupported Git object")
            relative = Path(name[len(prefix):])
            if relative.is_absolute() or ".." in relative.parts:
                raise SmokeError("Historical context path is unsafe")
            raw = git("cat-file", "blob", oid.decode())
            if len(raw) > 2 * 1024**2 or hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest() != oid.decode():
                raise SmokeError("Historical context blob identity/size is invalid")
            path = output / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("xb") as target:
                target.write(raw)
            path.chmod(0o755 if mode == b"100755" else 0o644)
        return {"revision": OLD_REVISION, "tree": OLD_TREE, **context_record(output, legacy=True)}
    except BaseException:
        shutil.rmtree(output)
        raise


def engine_metadata(raw, revision: str, context_sha: str, *, legacy: bool = False) -> dict:
    if not isinstance(raw, list) or len(raw) != 1 or not isinstance(raw[0], dict):
        raise SmokeError("Engine image inspection is invalid")
    image = raw[0]
    config = image.get("Config") or {}
    labels = config.get("Labels") or {}
    if image.get("Os") != "linux" or image.get("Architecture") != "amd64":
        raise SmokeError("Engine qualification requires the actual Linux/amd64 final image")
    if legacy and (revision != OLD_REVISION or context_sha != OLD_CONTEXT_SHA):
        raise SmokeError("Historical image cannot be relabeled as the candidate revision")
    if not legacy and config.get("User") != "65532:65532":
        raise SmokeError("Engine image must default to numeric nonroot user 65532:65532")
    if legacy and config.get("User") not in {None, ""}:
        raise SmokeError("Historical baseline must retain its original root-default image configuration")
    entrypoint = ["docker-entrypoint.sh"] if legacy else ["/usr/local/bin/warpdrive-engine-entrypoint.sh"]
    if config.get("Entrypoint") != entrypoint or config.get("Cmd") != ["./listmonk"]:
        raise SmokeError("Engine default entrypoint/CMD does not match the qualified command contract")
    if config.get("WorkingDir") != "/listmonk" or config.get("Volumes"):
        raise SmokeError("Unexpected engine working directory or anonymous volume")
    if labels.get("org.opencontainers.image.revision") != revision or labels.get(CONTEXT_LABEL) != context_sha:
        raise SmokeError("Engine source/context labels do not match requested inputs")
    if labels.get("org.opencontainers.image.source") != UPSTREAM_SOURCE:
        raise SmokeError("Engine image must preserve the pinned upstream source attribution")
    for value in config.get("Env") or []:
        key, _, content = value.partition("=")
        if content and re.search(r"SECRET|PASSWORD|TOKEN|KEY|_FILE$", key, re.I):
            raise SmokeError("Final engine image contains a credential/file override")
    image_id = image.get("Id", "")
    if not re.fullmatch(r"sha256:[a-f0-9]{64}", image_id):
        raise SmokeError("Engine image has no immutable local image ID")
    return {"id": image_id, "revision": revision, "contextSha256": context_sha,
            "user": config.get("User") or "root-default", "legacyRootFixture": legacy,
            "platform": "linux/amd64", "upstreamSource": UPSTREAM_SOURCE}


def installer_fingerprint(source: Path) -> str:
    names = {p.relative_to(source).as_posix() for p in (source / "internal/migrations").rglob("*")
             if p.is_file() and not p.name.endswith("_test.go")}
    names.update(p.relative_to(source).as_posix() for p in (source / "cmd").rglob("*.sql"))
    names.update(("schema.sql", "cmd/install.go", "cmd/upgrade.go", "cmd/main.go", "cmd/init.go",
                  "cmd/warpdrive_migrations.go", "cmd/warpdrive_lifecycle.go", "cmd/crm_identity.go", "cmd/warpdrive_audiences.go",
                  "cmd/warpdrive_delivery_store.go", "cmd/warpdrive_readiness.go", "cmd/warpdrive_operational_events.go",
                  "internal/sesfeedback/feedback.go", "internal/sesfeedback/schema.sql"))
    checksums = "".join(f"{digest((source / name).read_bytes())}  {name}\n" for name in sorted(names))
    return digest(checksums.encode())


def verify_source_archive(path: Path, expected: dict, destination: Path, *, patch_context: Path = CONTEXT, legacy: bool = False) -> str:
    maximum = len(expected["files"]) + 2
    with bounded_tar(path, 64 * 1024**2, maximum) as archive:
        entries = {}
        count = total = 0
        for member in archive:
            count += 1
            total += member.size
            if count > maximum or member.size < 0 or total > 64 * 1024**2:
                raise SmokeError("Corresponding-source archive member count/size exceeds bound")
            if not member.isfile() or member.name in entries or not Path(member.name).is_relative_to(".") or ".." in Path(member.name).parts:
                raise SmokeError("Corresponding-source archive contains an unsafe entry")
            entries[member.name] = archive.extractfile(member).read()
        if set(entries) != set(expected["files"]) | {"LICENSE", "listmonk-ef0a758.tar.gz"}:
            raise SmokeError("Corresponding-source archive is not the exact reviewed context")
        for name, sha in expected["files"].items():
            if digest(entries[name]) != sha:
                raise SmokeError("Corresponding-source archive input differs from reviewed context")
        if digest(entries["listmonk-ef0a758.tar.gz"]) != UPSTREAM_SHA:
            raise SmokeError("Corresponding-source upstream archive is not pinned")
        upstream = destination / "upstream.tar.gz"
        upstream.write_bytes(entries["listmonk-ef0a758.tar.gz"])
    source = destination / "source"
    source.mkdir()
    with bounded_tar(upstream, 128 * 1024**2, 20000) as tar:
        count = total = 0
        for member in tar:
            count += 1
            total += member.size
            if count > 20000 or member.size < 0 or total > 128 * 1024**2:
                raise SmokeError("Pinned source member count/size exceeds bound")
            parts = Path(member.name).parts[1:]
            if not parts:
                continue
            if member.issym() or member.islnk() or ".." in parts:
                raise SmokeError("Pinned source member is unsafe")
            member.name = str(Path(*parts))
            tar.extract(member, source, filter="data")
    for patch in sorted((patch_context / "patches").glob("*.patch")):
        result = subprocess.run(["git", "apply", str(patch)], cwd=source, capture_output=True, timeout=10)
        if result.returncode:
            raise SmokeError("Reviewed engine patches do not apply to archived source")
    if legacy:
        files = {p.relative_to(source).as_posix(): digest(p.read_bytes()) for p in sorted(source.rglob("*")) if p.is_file()}
        return digest(json.dumps(files, sort_keys=True, separators=(",", ":")).encode())
    return installer_fingerprint(source)


def native_contract():
    spec = importlib.util.spec_from_file_location("_engine_native_migration", CONTEXT / "migration-tests/verify.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


NATIVE = native_contract()


class ContainerProcess:
    """Only actual owned container state determines process completion."""
    def __init__(self, fixture, name):
        self.fixture, self.name = fixture, name

    def poll(self):
        state = self.fixture.state(self.name)
        if state.get("OOMKilled"):
            raise SmokeError("Final engine process was OOM killed")
        if state["Running"]:
            return None
        code = state.get("ExitCode")
        if type(code) is not int:
            raise SmokeError("Final engine exit state is invalid")
        return code

    def wait(self, timeout=25):
        self.fixture.owned(self.name)
        self.fixture.docker.run(["wait", self.name], timeout=timeout)
        code = self.poll()
        if code is None:
            raise SmokeError("Final engine process remained running after wait")
        return code

    def terminate(self):
        self.fixture.owned(self.name)
        self.fixture.docker.run(["kill", "--signal", "TERM", self.name], timeout=10)

    def kill(self):
        self.fixture.owned(self.name)
        self.fixture.docker.run(["kill", "--signal", "KILL", self.name], timeout=10)


class EngineImageSmoke(ImageSmoke, NATIVE.MigrationFixture):
    def __init__(self, docker, image: str, revision: str, output: Path,
                 old_image: str | None = None, old_context: Path | None = None):
        self.docker, self.image = docker, validate_reference(image)
        self.expected_revision, self.output_dir = validate_revision(revision), output
        self.prefix = "wd-engine-" + uuid.uuid4().hex[:12]
        self.resources, self.containers = [], {}
        self.clock, self.sleep = time.monotonic, time.sleep
        self.context = context_record()
        self.old_image = validate_reference(old_image) if old_image else None
        self.old_context_path = old_context
        self.old_context = context_record(old_context, legacy=True) if old_context is not None else None
        self.uploads_volume = None
        self.old_binary_retired = False
        self.counter, self.serve = 0, None
        self.pg_bin, self.socket, self.root = Path("/usr/local/bin"), Path("/var/run/postgresql"), output
        password = secrets.token_urlsafe(32)
        self.pg_env = {"POSTGRES_USER": "consentproof", "POSTGRES_PASSWORD": password, "POSTGRES_DB": "consent"}
        self.env = {"LISTMONK_app__address": "127.0.0.1:9000", "LISTMONK_db__host": "postgres",
                    "LISTMONK_db__port": "5432", "LISTMONK_db__user": "consentproof", "LISTMONK_db__database": "consent",
                    "LISTMONK_db__password": password, "LISTMONK_db__ssl_mode": "disable", "LISTMONK_db__max_open": "4",
                    "LISTMONK_db__max_idle": "2", "LISTMONK_db__max_lifetime": "300s", "LISTMONK_db__params": "connect_timeout=3",
                    "LISTMONK_ADMIN_USER": "consent-proof", "LISTMONK_ADMIN_PASSWORD": secrets.token_urlsafe(24),
                    "LISTMONK_ADMIN_API_USER": "consent-proof-api", "NEWSLETTER_DELIVERY_ENABLED": "false",
                    "NEWSLETTER_PUBLIC_SIGNUP_ENABLED": "false", "NEWSLETTER_SES_FEEDBACK_ENABLED": "false"}
        self.secret_directory, self.secret_file = None, None
        self.report = {"schemaVersion": 1, "success": False, "expectedRevision": revision, "startedAt": utc_now(),
                       "image": {}, "context": self.context, "checks": [], "failure": None, "diagnostics": [],
                       "resources": {"prefix": self.prefix, "network": self.prefix + "-network"},
                       "cleanup": {"success": False, "errors": []}, "limitations": LIMITATIONS}

    def owned(self, name):
        if ("container", name) not in self.resources:
            raise SmokeError("Unowned engine container read/control refused")
        labels = self.docker.json(["container", "inspect", name, "--format", "{{json .Config.Labels}}"])
        if not isinstance(labels, dict) or labels.get(OWNER_LABEL) != self.prefix:
            raise SmokeError("Engine container ownership changed; read/control refused")
        settings = self.docker.json(["container", "inspect", name, "--format", "{{json .NetworkSettings}}"])
        if not isinstance(settings, dict) or set(settings.get("Networks", {})) != {self.report["resources"]["network"]}:
            raise SmokeError("Owned engine fixture has an unexpected network attachment")
        if any(value for value in (settings.get("Ports") or {}).values()):
            raise SmokeError("Owned engine fixture unexpectedly publishes host ports")

    def state(self, name):
        self.owned(name)
        return ImageSmoke.state(self, name)

    def owned_volume(self, name):
        if ("volume", name) not in self.resources:
            raise SmokeError("Unowned engine media volume refused")
        labels = self.docker.json(["volume", "inspect", name, "--format", "{{json .Labels}}"])
        if not isinstance(labels, dict) or labels.get(OWNER_LABEL) != self.prefix:
            raise SmokeError("Engine media volume ownership changed")

    def engine(self, flags, environment=None, missing_file=False, entry_command=None, *, legacy=False, offline_media=False):
        if legacy and self.old_binary_retired and not offline_media:
            raise SmokeError("Retired historical engine cannot execute after the offline cutover fence")
        if offline_media:
            if (not legacy or not self.old_binary_retired or self.uploads_volume is None or not entry_command or len(entry_command) < 3 or entry_command[:2] != ["chown", "65532:65532"]
                    or len(entry_command) > 18 or any(not valid_media_path(path) for path in entry_command[2:])):
                raise SmokeError("Offline media handoff is limited to explicit owned fixture paths")
        self.counter += 1
        name = f"{self.prefix}-engine-{self.counter}"
        self.resources.append(("container", name))
        env = dict(self.env if environment is None else environment)
        args = ["run", "--detach", "--pull", "never", "--name", name, "--label", f"{OWNER_LABEL}={self.prefix}",
                "--network", self.report["resources"]["network"], "--memory", "256m", "--memory-swap", "256m",
                "--cpus", "1", "--pids-limit", "96", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
                "--read-only", "--log-opt", "max-size=1m", "--log-opt", "max-file=1",
                "--tmpfs", "/tmp:rw,nosuid,nodev,size=16m,uid=" + ("0,gid=0" if legacy else "65532,gid=65532") + ",mode=0700"]
        if offline_media:
            args += ["--cap-add", "CHOWN"]
        if self.uploads_volume is not None:
            self.owned_volume(self.uploads_volume)
            args += ["--mount", f"type=volume,source={self.uploads_volume},target=/listmonk/uploads"]
        if entry_command is None:
            if self.uploads_volume is None:
                args += ["--tmpfs", "/listmonk/uploads:rw,nosuid,nodev,size=16m,uid=65532,gid=65532,mode=0700"]
            # Every database command authenticates through the real *_FILE loader.
            # A wrong direct value prevents a loader bypass from passing.
            env["LISTMONK_db__password"] = "deliberately-wrong-synthetic-password"
            env["LISTMONK_db__password_FILE"] = "/run/absent-engine-secret" if missing_file else "/run/engine-db-password"
            if not missing_file:
                args += ["--mount", f"type=bind,source={self.secret_file},target=/run/engine-db-password,readonly"]
        for key, value in sorted(env.items()):
            args += ["--env", f"{key}={value}"]
        selected_image = self.report["oldImage"]["id"] if legacy else self.report["image"]["id"]
        args += [selected_image, *(entry_command if entry_command is not None else ["./listmonk", "--config", "", *flags])]
        self.docker.run(args, timeout=60)
        self.owned(name)
        return ContainerProcess(self, name)

    def pg_argv(self, arguments):
        self.owned(self.containers["postgres"])
        return ["docker", "--host", self.docker.endpoint, "exec", "--interactive", self.containers["postgres"], *arguments]

    def run(self, argv, **options):
        if Path(argv[0]).name not in {"psql", "pg_dump"}:
            raise SmokeError("Only owned PostgreSQL fixture tools are permitted")
        command = self.pg_argv(argv)
        try:
            result = self.docker.runner(command, env=self.docker.environment, capture_output=True,
                                        text=True, check=False, timeout=25, **options)
        except (OSError, subprocess.TimeoutExpired) as error:
            raise SmokeError("Owned PostgreSQL fixture tool did not finish") from error
        if result.returncode:
            raise SmokeError("Owned PostgreSQL fixture SQL/tool failed")
        return result

    def command(self, flags, database="consent", timeout=25):
        process = self.engine(flags, {**self.env, "LISTMONK_db__database": database})
        code = process.wait(timeout)
        self.owned(process.name)
        logs = self.docker.run(["logs", process.name], timeout=5)
        return subprocess.CompletedProcess([], code, logs.stdout, logs.stderr)

    def launch(self, env=None):
        self.stop_engine()
        actual = self.env if env is None else env
        if actual.get("LISTMONK_db__user") == "migration_runtime":
            # Native local sockets use trust for this synthetic role. The image
            # fixture uses authenticated TCP, so arrange its password as owner
            # before launching the restricted runtime, outside runtime admission.
            value = self.pg_env["POSTGRES_PASSWORD"].replace("'", "''")
            self.sql(f"ALTER ROLE migration_runtime PASSWORD '{value}'")
        self.serve = self.engine(["--passive"], actual)
        return self.serve

    def stop_engine(self):
        if self.serve is not None and self.serve.poll() is None:
            self.owned(self.serve.name)
            self.docker.run(["stop", "--time", "5", self.serve.name], timeout=12)
            if self.serve.poll() is None:
                raise SmokeError("Owned engine runtime did not stop")

    def request(self, path, headers=None, body=None, method=None):
        if path not in {"/health", "/api/warpdrive/readiness"} or body is not None or method is not None:
            raise SmokeError("Only bounded fixture health/readiness GETs are allowed")
        self.owned(self.serve.name)
        args = ["exec", self.serve.name, "wget", "-q", "-S", "-T", "4", "-O", "-"]
        for key, value in (headers or {}).items():
            if key != "Authorization" or value != self.auth["Authorization"]:
                raise SmokeError("Unexpected fixture HTTP header")
            args += ["--header", key + ": " + value]
        result = self.docker.run([*args, "http://127.0.0.1:9000" + path], check=False, timeout=8)
        statuses = re.findall(r"HTTP/\S+\s+(\d{3})", result.stderr or "")
        if not statuses:
            raise OSError("Owned container HTTP response unavailable")
        status = int(statuses[-1])
        if status < 400 and result.returncode != 0:
            raise OSError("Owned container HTTP transfer did not finish")
        return status, result.stdout.encode()

    def inspect_image(self):
        metadata = engine_metadata(self.docker.json(["image", "inspect", self.image]), self.expected_revision, self.context["sha256"])
        self.report["image"] = metadata
        return metadata

    def create_environment(self):
        network = self.report["resources"]["network"]
        self.resources.append(("network", network))
        self.docker.run(["network", "create", "--internal", "--label", f"{OWNER_LABEL}={self.prefix}", network])
        if self.docker.json(["network", "inspect", network, "--format", "{{json .Internal}}"]) is not True:
            raise SmokeError("Engine fixture network is not internal")
        volume = self.prefix + "-pgdata"
        self.resources.append(("volume", volume))
        self.docker.run(["volume", "create", "--label", f"{OWNER_LABEL}={self.prefix}", volume])
        ImageSmoke.start_container(self, "postgres", "postgres:16-alpine", [], environment=self.pg_env,
                                   mount=f"type=volume,source={volume},target=/var/lib/postgresql/data",
                                   memory="512m", pull="missing")
        self.wait_for(lambda: self.docker.run(["exec", self.containers["postgres"], "pg_isready", "-U", "consentproof", "-d", "consent"],
                                             check=False, timeout=5).returncode == 0,
                      "owned PostgreSQL", 60, self.containers["postgres"])
        return {"internalNetwork": True, "publishedPorts": 0, "sourceMounts": 0, "providers": "disabled"}

    def packaging(self):
        probe = self.engine([], {}, entry_command=["sh", "-ec", "test $(id -u) = 65532; test -x ./listmonk; "
                            "test -r warpdrive-engine-source.tar.gz; test ! -e /engine; test ! -e /go; "
                            "test ! -e /usr/local/go; test ! -e /listmonk/cmd; test ! -e /listmonk/internal; "
                            "test ! -e /listmonk/.env; test $(stat -c %u /listmonk/uploads) = 65532"])
        if probe.wait() != 0:
            raise SmokeError("Final engine source-free/nonroot packaging probe failed")
        copies = {}
        for name, target in (("listmonk", "/listmonk/listmonk"), ("warpdrive-engine-source.tar.gz", "/listmonk/warpdrive-engine-source.tar.gz"),
                             ("entrypoint.sh", "/usr/local/bin/warpdrive-engine-entrypoint.sh")):
            self.owned(probe.name)
            path = self.output_dir / name
            self.docker.run(["cp", probe.name + ":" + target, str(path)], timeout=20)
            if not path.is_file() or path.stat().st_size > 64 * 1024**2:
                raise SmokeError("Copied engine artifact shape/size is unqualified")
            copies[name] = {"sha256": digest(path.read_bytes()), "bytes": path.stat().st_size}
        binary = (self.output_dir / "listmonk").read_bytes()
        if binary[:6] != b"\x7fELF\x02\x01" or int.from_bytes(binary[18:20], "little") != 62:
            raise SmokeError("Packaged engine is not an actual amd64 ELF executable")
        if copies["entrypoint.sh"]["sha256"] != self.context["files"]["nonroot-entrypoint.sh"]:
            raise SmokeError("Installed engine entrypoint differs from archived source")
        with tempfile.TemporaryDirectory(prefix="engine-source-check-") as folder:
            fingerprint = verify_source_archive(self.output_dir / "warpdrive-engine-source.tar.gz", self.context, Path(folder))
            self.legacy_schema = (Path(folder) / "source/schema.sql").read_bytes()
        if fingerprint.encode() + b"\n" not in binary:
            raise SmokeError("Packaged engine does not embed reconstructed installer content fingerprint")
        self.report["artifacts"], self.report["installerSha256"] = copies, fingerprint
        return {"defaultUid": 65532, "readOnlyRoot": True, "unpackedSourceAbsent": True,
                "sourceArchiveMatchesContext": True, "installerSha256": fingerprint}

    def initialize(self):
        result = self.command(["--install", "--yes"])
        if result.returncode != 0:
            raise SmokeError("Final-image explicit fresh installation failed")
        token = re.search(r'export LISTMONK_ADMIN_API_TOKEN="([^"]+)"', result.stdout + result.stderr)
        if token is None:
            raise SmokeError("Synthetic fixture API token was not minted")
        self.env["IMAGE_SMOKE_API_TOKEN"] = token[1]
        self.auth = {"Authorization": "Basic " + base64.b64encode(("consent-proof-api:" + token[1]).encode()).decode()}
        self.env["IMAGE_SMOKE_AUTH_TOKEN"] = self.auth["Authorization"]
        self.sql(sys.modules["consent"].SQL_FIXTURES)
        missing = self.engine(["--version"], missing_file=True)
        if missing.wait() == 0:
            raise SmokeError("Missing secret file did not reject before version-only command")
        self.secret_file.chmod(0)
        try:
            unreadable = self.engine(["--version"])
            if unreadable.wait() == 0:
                raise SmokeError("Unreadable secret file did not reject before version-only command")
        finally:
            self.secret_file.chmod(0o444)
        return {"freshExplicitInstall": True, "authenticatedFilePassword": True, "missingFileRejected": True,
                "unreadableFileRejected": True}

    def empty_runtime(self):
        self.sql("CREATE DATABASE engine_empty", "postgres")
        before = self.snapshot("engine_empty")
        empty = self.engine(["--passive"], {**self.env, "LISTMONK_db__database": "engine_empty"})
        if empty.wait() != 1:
            raise SmokeError("Ordinary final-image startup did not refuse an empty database")
        if self.snapshot("engine_empty") != before:
            raise SmokeError("Ordinary final-image startup changed empty database state")
        return {"ordinaryStartupRejected": True, "durableWrites": 0}

    def migration_excludes_runtime(self):
        self.sql("DROP TABLE public.warpdrive_engine_schema")
        suffix = secrets.token_hex(8)
        migration_name, runtime_name = "engine_migrator_" + suffix, "engine_waiter_" + suffix
        holder = SimpleNamespace(psql_args=lambda: self.pg_argv(self.psql_args()),
                                 env=self.docker.environment, root=self.output_dir)
        migration = None
        try:
            with NATIVE.held_lock(holder, NATIVE.DELIVERY_KEY):
                migration = self.engine(["--migrate", "--yes"], {**self.env, "LISTMONK_db__params": "application_name=" + migration_name})
                def fenced():
                    if migration.poll() is not None:
                        raise SmokeError("Final-image migration exited before actual fence acquisition")
                    return self.sql("SELECT EXISTS(SELECT 1 FROM pg_locks l JOIN pg_stat_activity a USING(pid) "
                                    "WHERE a.datname=current_database() AND a.application_name='" + migration_name + "' "
                                    "AND l.locktype='advisory' AND l.classid=900731613 AND l.objid=90 "
                                    "AND l.objsubid=2 AND l.mode='ExclusiveLock' AND l.granted) "
                                    "AND EXISTS(SELECT 1 FROM pg_locks l JOIN pg_stat_activity a USING(pid) "
                                    "WHERE a.datname=current_database() AND a.application_name='" + migration_name + "' "
                                    "AND l.locktype='advisory' AND l.classid=900731613 AND l.objid=50 "
                                    "AND l.objsubid=2 AND NOT l.granted)") == "t"
                NATIVE.wait_until(fenced, "final-image migration exclusive lock", seconds=8)
                before = self.snapshot()
                runtime = self.launch({**self.env, "LISTMONK_db__params": "application_name=" + runtime_name})
                NATIVE.wait_for_runtime_lock(self, runtime, runtime_name, migration_name)
                NATIVE.assert_equal(runtime.wait(timeout=8), 1, "final-image shared-lock timeout")
                NATIVE.assert_equal(self.snapshot(), before, "blocked final-image startup changes no durable state")
            NATIVE.assert_equal(migration.wait(timeout=25), 0, "final-image migration after fixture lock release")
            self.receipt()
        finally:
            try:
                self.stop_engine()
            finally:
                if migration is not None and migration.poll() is None:
                    migration.terminate()
                    migration.wait(timeout=8)
        return {"actualOwnedSharedLockWait": True, "exclusiveMigration": True}

    def readiness(self):
        self.ready()
        stopped = []
        try:
            NATIVE.assert_equal(self.request("/api/warpdrive/readiness")[0], 403, "anonymous readiness denied")
            status, raw = self.request("/api/warpdrive/readiness", self.auth)
            value = json.loads(raw)["data"]
            if status != 200 or value["database"]["status"] != "ready" or value["scheduler"]["status"] != "passive" or value["ready"] is not False:
                raise SmokeError("Final-image passive readiness evidence is invalid")
            for selected_signal in ("TERM", "INT"):
                stopped.append(self.graceful_stop(selected_signal))
                self.ready()
                status, raw = self.request("/api/warpdrive/readiness", self.auth)
                value = json.loads(raw)["data"]
                if (status != 200 or value["database"]["status"] != "ready"
                        or value["scheduler"]["status"] != "passive" or value["ready"] is not False):
                    raise SmokeError("Final-image readiness did not recover after graceful stop")
        finally:
            self.stop_engine()
        return {"healthSurvived": True, "databaseReady": True, "passiveIsNotDeliveryReady": True, "anonymousDenied": True,
                "gracefulShutdown": stopped, "restartReadyAfterBothSignals": True}

    def graceful_stop(self, selected_signal):
        """Prove actual PID1 TERM/INT completion; logs or an acknowledgement cannot qualify it."""
        if selected_signal not in ("TERM", "INT") or self.serve is None:
            raise SmokeError("Only admitted final-image lifecycle signals are permitted")
        name = self.serve.name
        self.owned(name)
        before, = self.docker.json(["container", "inspect", name])
        identity = before.get("Id", "")
        state = before.get("State", {})
        if (re.fullmatch(r"[a-f0-9]{64}", identity) is None or before.get("Image") != self.report["image"]["id"]
                or before.get("Config", {}).get("Labels", {}).get(OWNER_LABEL) != self.prefix
                or state.get("Running") is not True or state.get("Status") != "running"
                or state.get("OOMKilled") is not False or type(state.get("Pid")) is not int or state["Pid"] <= 0
                or before.get("RestartCount") != 0):
            raise SmokeError("Final-image graceful stop requires an exact live owned PID1")
        operation = (["stop", "--time", "5", identity] if selected_signal == "TERM"
                     else ["kill", "--signal", "INT", identity])
        self.docker.run(operation, timeout=12)
        self.docker.run(["wait", identity], timeout=8)
        self.owned(name)
        after, = self.docker.json(["container", "inspect", identity])
        state = after.get("State", {})
        if (any(after.get(key) != before.get(key) for key in ("Id", "Image", "Config", "HostConfig", "Mounts", "RestartCount"))
                or state.get("Status") != "exited" or state.get("Running") is not False
                or any(state.get(key) is not False for key in ("OOMKilled", "Restarting", "Paused", "Dead"))
                or type(state.get("Pid")) is not int or state["Pid"] != 0
                or type(state.get("ExitCode")) is not int or state["ExitCode"] != 0):
            raise SmokeError("Final-image graceful signal did not finish cleanly")
        return {"signal": selected_signal, "containerId": identity, "exitCode": 0, "oomKilled": False, "pid": 0}

    def legacy_packaging(self):
        if self.old_image is None or self.old_context is None or self.old_context_path is None:
            raise SmokeError("Supported-old packed upgrade requires the pinned historical image and context")
        self.report["oldImage"] = engine_metadata(self.docker.json(["image", "inspect", self.old_image]),
                                                OLD_REVISION, self.old_context["sha256"], legacy=True)
        self.report["oldSource"] = {"revision": OLD_REVISION, "tree": OLD_TREE, **self.old_context}
        probe = self.engine([], {}, legacy=True, entry_command=["sh", "-ec", "test $(id -u) = 0; test -x ./listmonk; test -r warpdrive-engine-source.tar.gz"])
        if probe.wait() != 0:
            raise SmokeError("Historical root-default packed image could not run its actual packaging probe")
        copies = {}
        for name in ("listmonk", "warpdrive-engine-source.tar.gz"):
            target = self.output_dir / ("old-" + name)
            self.owned(probe.name)
            self.docker.run(["cp", probe.name + ":/listmonk/" + name, str(target)], timeout=20)
            if not target.is_file() or target.stat().st_size > 64 * 1024**2:
                raise SmokeError("Historical packed artifact exceeds qualification bound")
            copies[name] = {"sha256": digest(target.read_bytes()), "bytes": target.stat().st_size}
        binary = (self.output_dir / "old-listmonk").read_bytes()
        if binary[:6] != b"\x7fELF\x02\x01" or int.from_bytes(binary[18:20], "little") != 62:
            raise SmokeError("Historical packed image is not the actual amd64 ELF baseline")
        with tempfile.TemporaryDirectory(prefix="old-engine-source-check-") as folder:
            source_sha = verify_source_archive(self.output_dir / "old-warpdrive-engine-source.tar.gz", self.old_context,
                                               Path(folder), patch_context=self.old_context_path, legacy=True)
        self.report["oldArtifacts"] = copies
        self.report["oldSource"]["reconstructedPatchedSourceSha256"] = source_sha
        return {"observedUid": 0, "rootAllowedOnlyForOwnedHistoricalFixture": True,
                "sourceArchiveMatchesOriginalContext": True}

    def upload_old_media(self):
        boundary = "engine-upgrade-" + secrets.token_hex(12)
        self.report["supportedOldUpgradePhase"] = "media-api-request"
        request = media_upload_request(self.auth["Authorization"], boundary)
        self.report["supportedOldUpgradePhase"] = "media-api-upload"
        self.owned(self.serve.name)
        # BusyBox wget --post-file uses strlen/%s and truncates this PNG at NUL.
        # Both request and response use binary streams. The script/loopback target
        # are fixed; headers and payload enter only stdin, never shell code/argv.
        try:
            result = self.docker.run(["exec", "--interactive", self.serve.name, "sh", "-ec",
                "nc -w 5 127.0.0.1 9000 2>/dev/null | head -c 16385"],
                input_bytes=request, timeout=10, check=False)
        except SmokeError:
            raise SmokeError("Historical media API transport did not finish") from None
        if result.returncode != 0:
            raise SmokeError("Historical media API transport did not succeed")
        status, response = parse_media_http_response(result.stdout)
        self.report["supportedOldMediaHttpStatus"] = status
        if status != 200:
            raise SmokeError(f"Historical media API upload rejected (status {status})")
        try:
            media = json.loads(response)["data"]
            filename = media["filename"]
        except (ValueError, KeyError, TypeError, RecursionError):
            raise SmokeError("Historical media API did not return a bounded fixture filename") from None
        if not isinstance(filename, str) or not re.fullmatch(r"[A-Za-z0-9_-][A-Za-z0-9_.-]{0,199}", filename):
            raise SmokeError("Historical media filename is unsafe")
        self.report["supportedOldUpgradePhase"] = "media-byte-verification"
        if self.media_bytes(filename) != UPGRADE_PNG:
            raise SmokeError("Historical media API did not preserve exact uploaded bytes")
        return filename

    def media_bytes(self, filename):
        if not re.fullmatch(r"[A-Za-z0-9_-][A-Za-z0-9_.-]{0,199}", filename):
            raise SmokeError("Upgrade media read is limited to its bounded synthetic filename")
        self.owned(self.serve.name)
        # Binary media never passes text decoding. The fixed shell script accepts
        # only an argv URL; no path, credential or user data becomes shell code.
        result = self.docker.run(["exec", self.serve.name, "sh", "-ec",
                                  'wget -q -T 5 -O /tmp/upgrade-media-read "$1"; base64 /tmp/upgrade-media-read',
                                  "engine-upgrade-media", "http://127.0.0.1:9000/uploads/" + filename], timeout=10)
        if len(result.stdout) > 8192:
            raise SmokeError("Upgrade media exceeds the synthetic fixture bound")
        try:
            return base64.b64decode("".join(result.stdout.split()), validate=True)
        except ValueError as error:
            raise SmokeError("Upgrade media did not return valid bounded bytes") from error

    def verify_old_stopped(self, old_process, application_name):
        state = self.state(old_process.name)
        if state["Running"] or state.get("Pid") != 0 or state.get("OOMKilled"):
            raise SmokeError("Historical runtime stop is unverified; migration is held")
        names = self.docker.run(["container", "ls", "--filter", "label=" + OWNER_LABEL + "=" + self.prefix,
                                 "--filter", "ancestor=" + self.report["oldImage"]["id"], "--format", "{{.Names}}"], timeout=10).stdout.splitlines()
        for name in names:
            self.owned(name)
            if self.state(name)["Running"]:
                raise SmokeError("A historical fixture process is still running; migration is held")
        NATIVE.wait_until(lambda: self.sql("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name='" + application_name + "'") == "0",
                          "historical database sessions closed before cutover", seconds=5)
        self.old_binary_retired = True
        return {"containerStopped": True, "pid": 0, "oldDatabaseSessions": 0, "runningHistoricalFixtureContainers": 0}

    def start_legacy_postgres(self, volume, image_id):
        if not re.fullmatch(r"sha256:[a-f0-9]{64}", image_id):
            raise SmokeError("Historical PostgreSQL fixture must use the already-inspected immutable fixture image")
        self.owned_volume(volume)
        name = self.prefix + "-legacy-postgres"
        self.resources.append(("container", name))
        args = ["run", "--detach", "--pull", "never", "--name", name, "--label", f"{OWNER_LABEL}={self.prefix}",
                "--network", self.report["resources"]["network"], "--memory", "512m", "--memory-swap", "512m",
                "--cpus", "1", "--pids-limit", "192", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
                "--log-opt", "max-size=1m", "--log-opt", "max-file=1",
                "--mount", f"type=volume,source={volume},target=/var/lib/postgresql/data"]
        # The official PG entrypoint needs only these bootstrap capabilities on
        # this fresh owned volume, matching the original fixture's initialization.
        for capability in ("CHOWN", "DAC_OVERRIDE", "FOWNER", "SETGID", "SETUID"):
            args += ["--cap-add", capability]
        for key, value in sorted(self.pg_env.items()):
            args += ["--env", key + "=" + value]
        self.docker.run([*args, image_id], timeout=60)
        self.containers["legacy-postgres"] = name
        self.owned(name)
        return name

    def supported_old_upgrade(self):
        legacy_packaging = self.legacy_packaging()
        self.stop_engine()
        original = (self.env, self.auth, self.serve, self.containers["postgres"], self.uploads_volume)
        original_cluster = self.sql("SELECT system_identifier::text FROM pg_control_system()")
        self.owned(original[3])
        postgres_image = self.docker.run(["container", "inspect", original[3], "--format", "{{.Image}}"], timeout=5).stdout.strip()
        cluster_volume, media_volume = self.prefix + "-legacy-pgdata", self.prefix + "-legacy-media"
        for volume in (cluster_volume, media_volume):
            self.resources.append(("volume", volume))
            self.docker.run(["volume", "create", "--label", f"{OWNER_LABEL}={self.prefix}", volume])
        legacy_pg = self.start_legacy_postgres(cluster_volume, postgres_image)
        self.containers["postgres"] = legacy_pg
        self.env = {**original[0], "LISTMONK_db__host": legacy_pg}
        self.uploads_volume = media_volume
        try:
            self.wait_for(lambda: self.docker.run(["exec", legacy_pg, "pg_isready", "-U", "consentproof", "-d", "consent"],
                                                 check=False, timeout=5).returncode == 0,
                          "separate historical PostgreSQL", 60, legacy_pg)
            if self.sql("SELECT system_identifier::text FROM pg_control_system()") == original_cluster:
                raise SmokeError("Historical baseline must use its own independently initialized PostgreSQL cluster")
            installed = self.engine(["--install", "--yes"], legacy=True)
            if installed.wait() != 0:
                raise SmokeError("Historical packed binary could not initialize its own database")
            logs = self.docker.run(["logs", installed.name], timeout=5)
            token = re.search(r'export LISTMONK_ADMIN_API_TOKEN="([^"]+)"', logs.stdout + logs.stderr)
            if token is None:
                raise SmokeError("Historical fixture API credential was not minted")
            self.auth = {"Authorization": "Basic " + base64.b64encode(("consent-proof-api:" + token[1]).encode()).decode()}
            for env in (self.env, original[0]):
                env["IMAGE_SMOKE_OLD_API_TOKEN"] = token[1]
                env["IMAGE_SMOKE_OLD_AUTH_TOKEN"] = self.auth["Authorization"]
            self.sql(OLD_INITIAL_SEED)
            application_name = "legacy_engine_" + secrets.token_hex(8)
            self.env["LISTMONK_db__params"] = "connect_timeout=3 application_name=" + application_name
            self.serve = self.engine(["--passive"], legacy=True)
            NATIVE.wait_until(self.healthy, "actual historical packed runtime", seconds=12)
            if self.sql("SELECT c.status||':'||r.hold||':'||c.sent||':'||c.last_subscriber_id FROM campaigns c JOIN warpdrive_delivery_runs r ON r.campaign_id=c.id WHERE c.id=999") != "paused:legacy:1:7":
                raise SmokeError("Actual historical runtime did not establish its genuine legacy campaign hold")
            self.sql(OLD_WITNESSES)
            filename = self.upload_old_media()
            if self.sql(OLD_WITNESS_CHECK) != "t":
                raise SmokeError("Historical consent/delivery/operational preservation witnesses are incomplete")
            self.owned(self.serve.name)
            paths = self.docker.run(["exec", self.serve.name, "find", "/listmonk/uploads", "-maxdepth", "2", "-print"], timeout=5).stdout.splitlines()
            if not paths or len(paths) > 16 or any(not valid_media_path(path) for path in paths):
                raise SmokeError("Historical media tree exceeds bounded ownership handoff")
            links = self.docker.run(["exec", self.serve.name, "find", "/listmonk/uploads", "-maxdepth", "2", "-type", "l", "-print"], timeout=5).stdout.strip()
            if links:
                raise SmokeError("Historical fixture media contains an unsupported symbolic link")
            old_process = self.serve
            self.stop_engine()
            stopped = self.verify_old_stopped(old_process, application_name)
            if self.sql("SELECT to_regclass('public.warpdrive_engine_schema') IS NULL") != "t":
                raise SmokeError("Historical baseline unexpectedly already has the new explicit migration receipt")
            before = self.snapshot()
            # This explicit, offline handoff touches only the new owned fixture
            # volume. It is not automatic migration of an installed upload store.
            handed = self.engine([], {}, legacy=True, offline_media=True, entry_command=["chown", "65532:65532", *paths])
            if handed.wait() != 0:
                raise SmokeError("Owned offline media ownership handoff failed")
            self.env["LISTMONK_db__params"] = "connect_timeout=3 application_name=new_engine_upgrade"
            result = self.command(["--migrate", "--yes"])
            if result.returncode != 0:
                raise SmokeError("New final-image migrator did not upgrade actual historical packed data")
            receipt = self.receipt()
            upgraded = self.snapshot()
            if not preserved_rows(before, upgraded, added_receipt=True) or self.sql(OLD_WITNESS_CHECK) != "t":
                raise SmokeError("Historical data/receipts/writer holds changed across explicit upgrade")
            self.migrate()
            if self.snapshot() != upgraded:
                raise SmokeError("Repeated supported-old migration changed durable data, catalog or sequence state")
            NATIVE.prove_restricted_no_ddl_start(self)
            self.ready()
            self.sleep(6)
            self.assert_running(self.serve.name)
            if self.media_bytes(filename) != UPGRADE_PNG or self.sql(OLD_WITNESS_CHECK) != "t":
                raise SmokeError("New passive runtime changed historical writer holds or media bytes")
            self.stop_engine()
            after = self.snapshot()
            if not preserved_rows(upgraded, after) or self.receipt() != receipt:
                raise SmokeError("New passive/read-only admission changed preserved historical row or receipt state")
            return {"oldRevision": OLD_REVISION, "oldImageId": self.report["oldImage"]["id"],
                    "newImageId": self.report["image"]["id"], "oldPackaging": legacy_packaging,
                    "separatePostgresCluster": True, "postgresFixtureImageId": postgres_image, "oldStoppedBeforeMigration": stopped,
                    "oldLegacyHoldEstablishedAndPreserved": True, "pendingUnknownAndAcknowledgedReceiptsPreserved": True,
                    "consentRevocationAndKeyedSuppressionPreserved": True,
                    "historicalTableRows": {key: value for key, value in before.items() if key.startswith("table:")},
                    "media": {"filename": filename, "bytes": len(UPGRADE_PNG), "sha256": digest(UPGRADE_PNG)},
                    "fixtureOnlyOfflineMediaOwnershipHandoff": True, "repeatMigrationNoWrites": True,
                    "newRestrictedRoleAdmission": True, "passiveWitnessWindowSeconds": 6,
                    "installedVpsUpgradeQualified": False}
        finally:
            try:
                self.stop_engine()
            finally:
                self.env, self.auth, self.serve, self.containers["postgres"], self.uploads_volume = original

    def qualify(self):
        self.output_dir.mkdir(parents=True, exist_ok=False)
        previous_signals = {kind: signal.getsignal(kind) for kind in (signal.SIGALRM, signal.SIGTERM, signal.SIGINT)}
        def expired(_signal, _frame):
            raise SmokeError("Final-image engine qualification deadline exceeded")
        for kind in previous_signals:
            signal.signal(kind, expired)
        signal.alarm(900)
        try:
            daemon = self.docker.json(["info", "--format", '{"os":{{json .OSType}},"architecture":{{json .Architecture}},"root":{{json .DockerRootDir}}}'], timeout=10)
            admit_native_platform(platform.system(), platform.machine(), daemon)
            self.report["nativePlatform"] = {"host": "linux/amd64", "daemon": "linux/amd64"}
            self.docker_root = Path(daemon.get("root", ""))
            if not self.docker_root.is_absolute() or not self.docker_root.is_dir():
                raise SmokeError("Engine qualification requires a native host-visible Docker root")
            self.initial_free = shutil.disk_usage(self.docker_root).free
            self.capacity()
            backing = admit_secret_tmpfs()
            self.secret_directory = tempfile.TemporaryDirectory(prefix="wd-engine-secret-", dir=backing)
            self.secret_file = write_synthetic_secret(Path(self.secret_directory.name), self.pg_env["POSTGRES_PASSWORD"])
            self.report["syntheticSecretStorage"] = {"filesystem": "tmpfs", "privateParentMode": "0700",
                                                      "mountedFileMode": "0444", "diskFallback": False,
                                                      "swapPolicyAttested": False}
            self.check("immutable-final-engine-image", self.inspect_image)
            self.check("owned-internal-fixture", self.create_environment)
            self.check("actual-final-image-packaging", self.packaging)
            self.check("empty-runtime-refuses-schema-writes", self.empty_runtime)
            self.check("file-secret-loader-and-fresh-install", self.initialize)
            for name, operation in (
                ("fresh-repeat-no-write-migration", lambda: NATIVE.prove_fresh_migration(self)),
                ("pinned-schema-legacy-holds", lambda: NATIVE.prove_legacy_fence(self, self.archived_schema().decode())),
                ("explicit-upgrade-and-no-write", lambda: NATIVE.prove_noop_and_upgrade(self)),
                ("receipt-and-index-drift-rejection", lambda: NATIVE.prove_admission_failures(self)),
                ("restricted-role-no-ddl-startup", lambda: NATIVE.prove_restricted_no_ddl_start(self)),
                ("rls-policy-sequence-drift-rejection", lambda: NATIVE.prove_policy_and_sequence_drift(self)),
                ("runtime-excludes-migration", lambda: NATIVE.prove_runtime_excludes_migration(self)),
                ("migration-excludes-actual-runtime", self.migration_excludes_runtime),
                ("fence-loss-exits-and-restarts", lambda: NATIVE.prove_runtime_fence_loss(self)),
                ("final-image-health-and-readiness", self.readiness),
                ("supported-old-packed-binary-upgrade", self.supported_old_upgrade),
            ):
                self.capacity()
                self.check(name, operation)
            self.capacity()
            if not required_checks_passed(self.report["checks"]):
                raise SmokeError("Engine qualification did not execute all required checks")
        except BaseException as error:
            self.report["failure"] = str(error) if isinstance(error, SmokeError) else type(error).__name__
        finally:
            signal.alarm(0)
            if self.report["failure"] is not None:
                self.report["diagnostics"] = self.failure_diagnostics()
            errors = self.cleanup()
            try:
                if self.secret_directory is not None:
                    self.secret_directory.cleanup()
            except OSError:
                errors.append("Synthetic secret fixture cleanup failed")
            self.report["cleanup"] = {"success": not errors, "errors": errors}
            self.report["finishedAt"] = utc_now()
            self.report["success"] = self.report["failure"] is None and not errors
            (self.output_dir / "report.json").write_text(json.dumps(self.report, indent=2) + "\n")
            for kind, previous in previous_signals.items():
                signal.signal(kind, previous)
        return self.report["success"]

    def capacity(self):
        available = shutil.disk_usage(self.docker_root).free
        growth = max(0, self.initial_free - available)
        if available < 8 * 1024**3 or growth > 3 * 1024**3:
            raise SmokeError("Owned engine fixture exceeded disk growth/reserve admission")
        self.report["capacity"] = {"availableBytes": available, "maxObservedGrowthBytes": max(growth, self.report.get("capacity", {}).get("maxObservedGrowthBytes", 0)),
                                   "growthLimitBytes": 3 * 1024**3, "reserveBytes": 8 * 1024**3, "deadlineSeconds": 900}

    def archived_schema(self):
        raw = self.legacy_schema
        if digest(raw) != NATIVE.UPSTREAM_SCHEMA_SHA256:
            raise SmokeError("Legacy fixture schema differs from pinned upstream")
        return raw


def main(arguments=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image")
    parser.add_argument("--expected-revision")
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--old-image", help="Actual packed image built from the pinned supported-old revision")
    parser.add_argument("--old-context", type=Path, help="Verified original historical context, with no rewritten inputs")
    parser.add_argument("--old-checkout", type=Path, help="Checkout whose HEAD is the pinned supported-old commit")
    parser.add_argument("--prepare-old-context", type=Path, help="Materialize only Git-verified historical engine blobs into a new directory")
    parser.add_argument("--context-digest", action="store_true", help="Print deterministic reviewed build-context fingerprint only")
    args = parser.parse_args(arguments)
    if args.prepare_old_context is not None:
        if args.old_checkout is None:
            parser.error("--prepare-old-context requires --old-checkout")
        print(json.dumps(prepare_old_context(args.old_checkout, args.prepare_old_context), sort_keys=True))
        return 0
    if args.context_digest:
        print(context_record()["sha256"])
        return 0
    if not all((args.image, args.expected_revision, args.output_dir, args.old_image, args.old_context)):
        parser.error("--image, --expected-revision, --output-dir, --old-image and --old-context are required")
    validate_reference(args.image)
    validate_revision(args.expected_revision)
    validate_reference(args.old_image)
    with tempfile.TemporaryDirectory(prefix="wd-engine-docker-") as directory:
        docker = IsolatedDocker(Path(directory) / "config")
        fixture = EngineImageSmoke(docker, args.image, args.expected_revision, args.output_dir, args.old_image, args.old_context)
        return 0 if fixture.qualify() else 1


if __name__ == "__main__":
    sys.exit(main())
