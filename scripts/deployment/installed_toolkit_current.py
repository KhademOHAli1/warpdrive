"""Activate an exact received operator toolkit without changing application state."""

import argparse
from contextlib import contextmanager
import fcntl
from hashlib import sha256
import json
import os
from pathlib import Path
import secrets
import stat
import subprocess
import sys

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve(strict=True).parent))

import installed_web_toolkit_transport as transport


CURRENT = "current-toolkit.json"
PENDING = "pending-toolkit-activation.json"
LOCK = "toolkit-activation.lock"
LOCK_BYTES = b"warpdrive-installed-toolkit-current-v1\n"
STATUS = "scripts/deployment/installed_web_monitor_schedule.py"
SELF = "scripts/deployment/installed_toolkit_current.py"
MAX_RECORD = 16 * 1024
ABSENT = "absent"


class ToolkitHeld(ValueError):
    pass


class ToolkitUnknown(ToolkitHeld):
    pass


def require(value, fact):
    if not value:
        raise ToolkitHeld(fact)


def _raw(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode() + b"\n"


def _hash(raw):
    return ABSENT if raw is None else sha256(raw).hexdigest()


def _pin(value):
    return isinstance(value, str) and transport.SHA.fullmatch(value) is not None


def _identity(value):
    require(type(value) is dict and set(value) == {"destination", "manifestSha256", "receiptSha256", "sourceRevision"}
            and isinstance(value["destination"], str) and transport.DESTINATION.fullmatch(value["destination"])
            and all(_pin(value[key]) for key in ("manifestSha256", "receiptSha256"))
            and isinstance(value["sourceRevision"], str) and transport.REVISION.fullmatch(value["sourceRevision"]),
            "Exact received toolkit identity required")
    return value


def _pointer(raw):
    value = transport._json(raw)
    require(type(value) is dict and set(value) == {"schemaVersion", "kind", "operationId", "beforeSha256", "current", "previous"}
            and type(value["schemaVersion"]) is int and value["schemaVersion"] == 1
            and value["kind"] == "warpdrive-installed-toolkit-current"
            and isinstance(value["operationId"], str) and transport.DESTINATION.fullmatch(value["operationId"])
            and (value["beforeSha256"] == ABSENT or _pin(value["beforeSha256"])) and _raw(value) == raw,
            "Foreign or noncanonical toolkit pointer refused")
    _identity(value["current"])
    if value["previous"] is not None:
        _identity(value["previous"])
    return value


def _read(parent, name):
    try:
        return transport._private_bytes(parent, name, MAX_RECORD)
    except FileNotFoundError:
        return None


def _write(parent, name, value, *, replace=False):
    raw = _raw(value)
    require(len(raw) <= MAX_RECORD, "Toolkit activation record exceeds its bound")
    temporary = ".toolkit-current-" + secrets.token_hex(12)
    descriptor = os.open(temporary, transport.NEW_FILE_FLAGS, 0o600, dir_fd=parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            require(stream.write(raw) == len(raw), "Incomplete toolkit activation record")
            stream.flush()
            os.fsync(stream.fileno())
        if replace:
            os.replace(temporary, name, src_dir_fd=parent, dst_dir_fd=parent)
        else:
            transport._rename_noreplace(parent, temporary, name)
        os.fsync(parent)
    finally:
        try:
            os.unlink(temporary, dir_fd=parent)
        except FileNotFoundError:
            pass


@contextmanager
def _locked(installation):
    installation = Path(installation)
    with transport._open_directory(installation), transport._open_directory(installation / "operators") as parent:
        try:
            descriptor = os.open(LOCK, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent)
        except FileExistsError:
            descriptor = os.open(LOCK, os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        else:
            os.write(descriptor, LOCK_BYTES)
            os.fsync(descriptor)
            os.fsync(parent)
        try:
            info = os.fstat(descriptor)
            require(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid() and stat.S_IMODE(info.st_mode) == 0o600
                    and info.st_nlink == 1 and os.pread(descriptor, len(LOCK_BYTES) + 1, 0) == LOCK_BYTES,
                    "Foreign toolkit lock refused")
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            require(transport._witness(info) == transport._witness(os.stat(LOCK, dir_fd=parent, follow_symlinks=False)),
                    "Toolkit lock path changed")
            yield parent
        finally:
            os.close(descriptor)


def _verified(installation, destination, pin):
    require(isinstance(destination, str) and transport.DESTINATION.fullmatch(destination) and _pin(pin),
            "Exact independently pinned toolkit destination required")
    path = installation / "operators" / destination
    receipt = transport.readback(path, pin)
    with transport._open_directory(path) as parent:
        raw = transport._private_bytes(parent, transport.MANIFEST_NAME, transport.MAX_MANIFEST)
    require(_hash(raw) == pin, "Toolkit manifest changed after transport readback")
    manifest = transport._json(raw)
    require(manifest.get("functionalOperatorEntry") == transport.FUNCTIONAL_OPERATOR
            and manifest.get("coreOperatorEntry") == transport.CORE_OPERATOR
            and {STATUS, SELF} <= manifest["pins"].keys(), "Modern toolkit and fixed status/activation source are required")
    return {"destination": destination, "manifestSha256": pin, "receiptSha256": _hash(_raw(receipt)),
            "sourceRevision": manifest["repositoryHead"]}


def _verify_identity(installation, identity):
    _identity(identity)
    require(_verified(installation, identity["destination"], identity["manifestSha256"]) == identity,
            "Received toolkit identity differs from accepted pointer")


def _intent(raw):
    value = transport._json(raw)
    require(type(value) is dict and set(value) == {"schemaVersion", "kind", "after"}
            and type(value["schemaVersion"]) is int and value["schemaVersion"] == 1
            and value["kind"] == "warpdrive-installed-toolkit-activation"
            and _raw(value) == raw, "Foreign activation intent refused")
    _pointer(_raw(value["after"]))
    return value


def _receipt(pointer):
    return {"kind": "warpdrive-installed-toolkit-activation-receipt", "state": "verified",
            "currentSha256": _hash(_raw(pointer)), "current": pointer["current"], "previous": pointer["previous"],
            "operationId": pointer["operationId"], "applicationStateChanged": False, "deploymentAuthorized": False}


def _finish(installation, parent, intent):
    pointer = intent["after"]
    require(_read(parent, CURRENT) == _raw(pointer), "Pending toolkit activation has no verified current-pointer outcome")
    _verify_identity(installation, pointer["current"])
    if pointer["previous"] is not None:
        _verify_identity(installation, pointer["previous"])
    os.fsync(parent)
    name = "toolkit-activation-" + pointer["operationId"] + ".json"
    transport._rename_noreplace(parent, PENDING, name)
    os.fsync(parent)
    return _receipt(pointer)


def activate(installation, *, destination, manifest_sha256, expected_current_sha256, operation_id):
    installation = Path(installation)
    require((expected_current_sha256 == ABSENT or _pin(expected_current_sha256))
            and isinstance(operation_id, str) and transport.DESTINATION.fullmatch(operation_id), "Exact activation CAS and operation required")
    with _locked(installation) as parent:
        wanted = _verified(installation, destination, manifest_sha256)
        pending = _read(parent, PENDING)
        prior = _read(parent, "toolkit-activation-" + operation_id + ".json")
        if pending is not None or prior is not None:
            intent = _intent(pending if pending is not None else prior)
            after = intent["after"]
            require(after["operationId"] == operation_id and after["current"] == wanted
                    and after["beforeSha256"] == expected_current_sha256, "Existing activation has different independent pins")
            if pending is not None:
                return _finish(installation, parent, intent)
            require(_read(parent, CURRENT) == _raw(after), "A later activation supersedes this operation")
            _verify_identity(installation, wanted)
            os.fsync(parent)
            return _receipt(after)
        before = _read(parent, CURRENT)
        require(_hash(before) == expected_current_sha256, "Toolkit current pointer differs from expected CAS")
        previous = None
        if before is not None:
            previous = _pointer(before)["current"]
            _verify_identity(installation, previous)
        pointer = {"schemaVersion": 1, "kind": "warpdrive-installed-toolkit-current", "operationId": operation_id,
                   "beforeSha256": expected_current_sha256, "current": wanted, "previous": previous}
        intent = {"schemaVersion": 1, "kind": "warpdrive-installed-toolkit-activation", "after": pointer}
        _write(parent, PENDING, intent)
        try:
            require(_read(parent, CURRENT) == before, "Toolkit pointer changed after durable activation intent")
            _write(parent, CURRENT, pointer, replace=before is not None)
            return _finish(installation, parent, intent)
        except (Exception, KeyboardInterrupt) as error:
            raise ToolkitUnknown("Activation outcome requires readback of the same operation") from error


def readback(installation, *, expected_current_sha256, operation_id=None):
    installation = Path(installation)
    require(expected_current_sha256 == ABSENT or _pin(expected_current_sha256), "Independent current pointer SHA-256 required")
    with _locked(installation) as parent:
        raw = _read(parent, CURRENT)
        require(_hash(raw) == expected_current_sha256, "Current toolkit pointer differs from independent pin")
        if raw is None:
            require(_read(parent, PENDING) is None, "Pending activation has not replaced the predecessor; manual reconciliation required")
            return {"state": "not-installed", "currentSha256": ABSENT, "applicationStateChanged": False}
        pointer = _pointer(raw)
        if operation_id is not None:
            require(pointer["operationId"] == operation_id, "Current toolkit belongs to a different activation")
        pending = _read(parent, PENDING)
        if pending is not None:
            intent = _intent(pending)
            require(intent["after"] == pointer, "Pending activation differs from selected current pointer")
            return _finish(installation, parent, intent)
        archived = _read(parent, "toolkit-activation-" + pointer["operationId"] + ".json")
        require(archived is not None and _intent(archived)["after"] == pointer, "Current toolkit has no accepted activation journal")
        _verify_identity(installation, pointer["current"])
        if pointer["previous"] is not None:
            _verify_identity(installation, pointer["previous"])
        os.fsync(parent)
        return _receipt(pointer)


def rollback(installation, *, expected_current_sha256, operation_id):
    observed = readback(installation, expected_current_sha256=expected_current_sha256)
    previous = observed["previous"]
    require(previous is not None, "No previous stable toolkit is available")
    return activate(installation, destination=previous["destination"], manifest_sha256=previous["manifestSha256"],
                    expected_current_sha256=expected_current_sha256, operation_id=operation_id)


def run_status(installation, *, expected_current_sha256, original, state, target_key, runner=subprocess.run):
    installation, original, state = map(Path, (installation, original, state))
    require(isinstance(target_key, str) and transport.DESTINATION.fullmatch(target_key), "Exact installed target key required")
    for path in (original, state):
        require(path != installation / "private" and path.is_relative_to(installation / "private"), "Status paths must remain in private installation state")
        with transport._open_directory(path):
            pass
    # Hold the activation lock through execution and both source checks. This
    # action only reads accepted journals and the pointer; it is not live health.
    with _locked(installation) as parent:
        require(_read(parent, PENDING) is None, "Reconcile pending activation before dispatch")
        before = _read(parent, CURRENT)
        require(before is not None and _hash(before) == expected_current_sha256, "Current toolkit changed before status dispatch")
        pointer = _pointer(before)
        archived = _read(parent, "toolkit-activation-" + pointer["operationId"] + ".json")
        require(archived is not None and _intent(archived)["after"] == pointer, "Status toolkit has no accepted activation journal")
        _verify_identity(installation, pointer["current"])
        source = installation / "operators" / pointer["current"]["destination"] / "source" / STATUS
        bootstrap = "import os,runpy,sys; p=sys.argv.pop(1); sys.path.insert(0,os.path.dirname(p)); runpy.run_path(p,run_name='__main__')"
        result = runner([sys.executable, "-I", "-B", "-c", bootstrap, str(source), "extract-current", "--original", str(original),
                         "--state", str(state), "--target-key", target_key], stdin=subprocess.DEVNULL, capture_output=True,
                        env={"PATH": "/usr/bin:/bin", "LC_ALL": "C", "PYTHONDONTWRITEBYTECODE": "1"}, cwd="/", timeout=30, check=False)
        require(result.returncode == 0 and isinstance(result.stdout, bytes) and 0 < len(result.stdout) <= 1024,
                "Installed read-only status is unavailable")
        status = transport._json(result.stdout)
        require(type(status) is dict and set(status) == {"operationId", "event"}, "Installed status response differs")
        _verify_identity(installation, pointer["current"])
        require(_read(parent, CURRENT) == before, "Current toolkit changed during status dispatch")
        return {**_receipt(pointer), "status": status, "liveHealthQualified": False}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--installation-root", required=True, type=Path)
    commands = parser.add_subparsers(dest="action", required=True)
    activate_cli = commands.add_parser("activate")
    activate_cli.add_argument("--destination", required=True)
    activate_cli.add_argument("--manifest-sha256", required=True)
    for command in (activate_cli, commands.add_parser("rollback")):
        command.add_argument("--operation-id", required=True)
        command.add_argument("--expected-current-sha256", required=True)
    observation = commands.add_parser("readback")
    observation.add_argument("--expected-current-sha256", required=True)
    observation.add_argument("--operation-id")
    dispatch = commands.add_parser("run")
    dispatch.add_argument("command", choices=("status",))
    dispatch.add_argument("--expected-current-sha256", required=True)
    for name in ("original", "state"):
        dispatch.add_argument("--" + name, required=True, type=Path)
    dispatch.add_argument("--target-key", required=True)
    args = parser.parse_args(argv)
    os.umask(0o077)
    try:
        require(os.geteuid() == 0, "Installed toolkit dispatcher requires the release owner")
        values = vars(args).copy()
        installation, action = values.pop("installation_root"), values.pop("action")
        if action == "run":
            values.pop("command")
        function = {"activate": activate, "readback": readback, "rollback": rollback, "run": run_status}[action]
        print(json.dumps(function(installation, **values), sort_keys=True))
    except (Exception, KeyboardInterrupt) as error:
        print(json.dumps({"state": "unknown" if isinstance(error, ToolkitUnknown) else "held", "errorType": type(error).__name__}), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
