"""Activate an exact received operator toolkit without changing application state."""

import argparse
from contextlib import contextmanager
import fcntl
from hashlib import sha256
import json
from itertools import combinations
import os
from pathlib import Path
import re
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
SDK_PRIVATE = Path("/root/warpdrive-deployment/private")
SDK_ACTIONS = ("stage", "observe", "promote", "rollback", "reapply", "recover", "recover-reapply",
               "reconcile-failed-stamps", "seal", "seal-readback")
SDK_REQUIRED = ("action", "operation", "first", "original", "previous", "suffix", "revision",
                "sdk_admission_sha256", "lineage_sha256", "lineage_index_sha256",
                "first_accepted_operation", "first_accepted_plan_sha256")
SDK_OPTIONAL = ("accepted_plan_sha256", "sealed_index_sha256", "retained_core", "retained_core_sha256",
                "core_activation_operation", "core_activation_lineage_sha256", "projected_lineage_sha256")
SDK_SECONDS = 1800
SDK_MAX_OUTPUT = 128 * 1024


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


def _sdk_argv(installation, arguments):
    """Validate the closed SDK operator argument contract without importing it.

    Keeping the SDK import out of this module preserves the old modern toolkit
    AST closure. Only an explicitly SDK-enabled manifest can dispatch its entry.
    """
    require(type(arguments) is dict and set(arguments) == set(SDK_REQUIRED) | set(SDK_OPTIONAL),
            "Exact fixed SDK operator arguments required")
    require(installation / "private" == SDK_PRIVATE and arguments["action"] in SDK_ACTIONS
            and type(arguments["suffix"]) is str and re.fullmatch(r"[a-f0-9]{12}", arguments["suffix"])
            and type(arguments["revision"]) is str and transport.REVISION.fullmatch(arguments["revision"])
            and type(arguments["first_accepted_operation"]) is str
            and re.fullmatch(r"web-[a-f0-9]{12}-reapply", arguments["first_accepted_operation"])
            and all(_pin(arguments[key]) for key in ("sdk_admission_sha256", "lineage_sha256",
                    "lineage_index_sha256", "first_accepted_plan_sha256")), "Exact SDK source, target and authority pins required")
    paths = tuple(arguments[name] for name in ("operation", "first", "original", "previous"))
    require(all(isinstance(path, Path) and path != SDK_PRIVATE and path.is_relative_to(SDK_PRIVATE) for path in paths)
            and arguments["operation"] == SDK_PRIVATE / ("sdk-web-release-" + arguments["suffix"])
            and all(not left.is_relative_to(right) and not right.is_relative_to(left)
                    for left, right in combinations(paths, 2)), "Exact independent SDK private operation paths required")
    for path in paths:
        with transport._open_directory(path):
            pass
    core, core_pin = arguments["retained_core"], arguments["retained_core_sha256"]
    require((core is None and core_pin is None)
            or (core == arguments["operation"] / "retained-core.json" and _pin(core_pin)),
            "Exact paired retained Core file and pin required")
    activation = tuple(arguments[key] for key in ("core_activation_operation", "core_activation_lineage_sha256",
                                                 "projected_lineage_sha256"))
    require(activation == (None, None, None) or (core is not None and type(activation[0]) is str
            and re.fullmatch(r"core-activation-[a-f0-9]{40}", activation[0]) and all(_pin(pin) for pin in activation[1:])),
            "Exact already completed Core projection pins required")
    require((_pin(arguments["accepted_plan_sha256"]) if arguments["action"] in {"seal", "seal-readback"}
             else arguments["accepted_plan_sha256"] is None), "SDK seal actions require an independent accepted plan pin")
    require((_pin(arguments["sealed_index_sha256"]) if arguments["action"] == "seal-readback"
             else arguments["sealed_index_sha256"] is None), "Only SDK seal-readback accepts an independent raw index pin")
    result = [arguments["action"]]
    for key in (*SDK_REQUIRED[1:], *SDK_OPTIONAL):
        value = arguments[key]
        if value is not None:
            result.extend(("--" + key.replace("_", "-"), str(value)))
    return result


def run_sdk(installation, *, expected_current_sha256, sdk_arguments, runner=subprocess.run):
    """Dispatch one fixed SDK action through the independently selected toolkit.

    This wrapper grants no artifact/backend authority. The SDK operator performs
    those admissions under its existing production/target locks. Any execution
    failure or lost/malformed response is unknown and must never trigger replay.
    """
    installation = Path(installation)
    require(_pin(expected_current_sha256), "Independent current toolkit pin required for SDK dispatch")
    arguments = _sdk_argv(installation, sdk_arguments)
    launched = False
    try:
        with _locked(installation) as parent:
            require(_read(parent, PENDING) is None, "Reconcile pending activation before SDK dispatch")
            before = _read(parent, CURRENT)
            require(before is not None and _hash(before) == expected_current_sha256, "Current toolkit changed before SDK dispatch")
            pointer = _pointer(before)
            archived = _read(parent, "toolkit-activation-" + pointer["operationId"] + ".json")
            require(archived is not None and _intent(archived)["after"] == pointer, "SDK toolkit has no accepted activation journal")
            _verify_identity(installation, pointer["current"])
            toolkit = installation / "operators" / pointer["current"]["destination"]
            with transport._open_directory(toolkit) as directory:
                raw = transport._private_bytes(directory, transport.MANIFEST_NAME, transport.MAX_MANIFEST)
            require(_hash(raw) == pointer["current"]["manifestSha256"]
                    and transport._json(raw).get("sdkOperatorEntry") == transport.SDK_OPERATOR,
                    "Current toolkit has no explicitly selected fixed SDK operator")
            source = toolkit / "source" / transport.SDK_OPERATOR
            bootstrap = "import os,runpy,sys; p=sys.argv.pop(1); sys.path.insert(0,os.path.dirname(p)); runpy.run_path(p,run_name='__main__')"
            launched = True
            try:
                result = runner([sys.executable, "-I", "-B", "-c", bootstrap, str(source), *arguments],
                    stdin=subprocess.DEVNULL, capture_output=True, cwd="/", timeout=SDK_SECONDS, check=False,
                    env={"PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
                         "LC_ALL": "C", "PYTHONDONTWRITEBYTECODE": "1"})
                # Even a nonzero child may have loaded/created/switched something.
                # Keep its detailed evidence private and report an uncertain result.
                require(result.returncode == 0 and type(result.stdout) is bytes and 0 < len(result.stdout) <= SDK_MAX_OUTPUT
                        and type(result.stderr) is bytes and result.stderr == b"", "SDK action has no exact successful response")
                response = transport._json(result.stdout)
                require(type(response) is dict and type(response.get("state")) is str
                        and re.fullmatch(r"[a-z][a-z0-9-]{0,63}", response["state"]), "SDK operator response differs")
                _verify_identity(installation, pointer["current"])
                require(_read(parent, CURRENT) == before, "Current toolkit changed during SDK dispatch")
            except (Exception, KeyboardInterrupt) as error:
                raise ToolkitUnknown("SDK action outcome requires native readback; do not replay") from error
            return {"kind": "warpdrive-installed-sdk-toolkit-dispatch", "currentSha256": _hash(before),
                    "current": pointer["current"], "action": arguments[0], "result": response,
                    "toolkitStateChanged": False}

    except (Exception, KeyboardInterrupt) as error:
        if launched:
            if isinstance(error, ToolkitUnknown):
                raise
            raise ToolkitUnknown("SDK action acknowledgement or lock readback is unknown; do not replay") from error
        raise


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
    sdk = commands.add_parser("sdk-web")
    sdk.add_argument("sdk_action", choices=SDK_ACTIONS)
    sdk.add_argument("--expected-current-sha256", required=True)
    for name in ("operation", "first", "original", "previous"):
        sdk.add_argument("--" + name, required=True, type=Path)
    for name in ("suffix", "revision", "sdk-admission-sha256", "lineage-sha256", "lineage-index-sha256",
                 "first-accepted-operation", "first-accepted-plan-sha256"):
        sdk.add_argument("--" + name, required=True)
    for name in ("accepted-plan-sha256", "sealed-index-sha256", "retained-core-sha256", "core-activation-operation",
                 "core-activation-lineage-sha256", "projected-lineage-sha256"):
        sdk.add_argument("--" + name)
    sdk.add_argument("--retained-core", type=Path)
    args = parser.parse_args(argv)
    os.umask(0o077)
    try:
        require(os.geteuid() == 0, "Installed toolkit dispatcher requires the release owner")
        values = vars(args).copy()
        installation, action = values.pop("installation_root"), values.pop("action")
        if action == "run":
            values.pop("command")
        if action == "sdk-web":
            expected = values.pop("expected_current_sha256")
            values["action"] = values.pop("sdk_action")
            values = {"expected_current_sha256": expected, "sdk_arguments": values}
        function = {"activate": activate, "readback": readback, "rollback": rollback,
                    "run": run_status, "sdk-web": run_sdk}[action]
        result = function(installation, **values)
        if action == "sdk-web":
            try:
                print(json.dumps(result, sort_keys=True))
                sys.stdout.flush()
            except (Exception, KeyboardInterrupt) as error:
                raise ToolkitUnknown("SDK action response publication is unknown; use native readback") from error
        else:
            print(json.dumps(result, sort_keys=True))
    except (Exception, KeyboardInterrupt) as error:
        print(json.dumps({"state": "unknown" if isinstance(error, ToolkitUnknown) else "held", "errorType": type(error).__name__}), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
