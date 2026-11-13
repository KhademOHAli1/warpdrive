"""Report the current installed Web rollout through the scoped Operations reporter."""

import argparse
import binascii
import io
import os
from pathlib import Path
import pwd
import stat
import subprocess
import sys

from component_inputs import decode
from installed_web_chain import _directory, _state
from installed_web_readback_lock import installed_web_readback_locks
from web_rollout import STATES, _validate
from web_rollout_monitor import _MAX_HANDOFF_BYTES, _locked_outbox, _stdin_handoff, read_handoff, read_observation, report_observation
from web_switch import HASH, NAME, SwitchConflict, canonical, content_hash, require


_OK = ("accepted", "unchanged", "idle")
_RESULTS = (*_OK, "rejected", "unknown", "held")
_ERRORS = (OSError, ValueError, TypeError, KeyError, AttributeError, SwitchConflict, binascii.Error)
_CLI_ERRORS = (*_ERRORS, subprocess.SubprocessError)
_RELEASE_UID = 0
_BOOTSTRAP = "import os, runpy, sys; path = sys.argv.pop(1); sys.path.insert(0, os.path.dirname(path)); runpy.run_path(path, run_name='__main__')"


def extract_current(original, state, *, target_key):
    """Select the newest exact native result, then revalidate it with native readback."""
    require(NAME.fullmatch(target_key), "Exact scheduled Web target required")
    with installed_web_readback_locks(original, state):
        directory = state / "web-rollouts"
        _directory(directory)
        latest = None
        for index, path in enumerate(directory.iterdir()):
            require(index < 1000 and path.suffix == ".json" and NAME.fullmatch(path.stem),
                    "Unexpected or oversized native Web journal inventory")
            observed = path.lstat().st_mtime_ns
            if latest is None or observed > latest[0]:
                latest = observed, path
        if latest is None:
            return b""
        path = latest[1]
        saved = _state(path)
        require(type(saved) is dict and set(saved) == {"plan", "state"} and saved["state"] in STATES,
                "Current journal has no native Web rollout outcome")
        plan = saved["plan"]
        _validate(plan)
        require(plan["targetKey"] == target_key and plan["operationId"] == path.stem,
                "Current Web rollout differs from the scheduled target")
        operation, pin = plan["operationId"], content_hash(plan)
    # The exact reader re-acquires all release locks and rejects ties, newer
    # journals, another unresolved operation and an inconsistent pointer.
    event = read_observation(original, state, operation, pin)
    raw = canonical({"operationId": operation, "event": event}) + b"\n"
    require(len(raw) <= _MAX_HANDOFF_BYTES, "Scheduled Web handoff exceeded its bound")
    return raw


def _pending_plan(outbox):
    with _locked_outbox(outbox):
        path = outbox / "web-monitor.json"
        if not os.path.lexists(path):
            return None
        state = _state(path)
        require(type(state) is dict and set(state) == {"binding", "sequence", "published", "pending"},
                "Exact scheduled Web outbox required")
        pending = state["pending"]
        if pending is None:
            return None
        pin = pending.get("planSha256") if type(pending) is dict else None
        require(isinstance(pin, str) and HASH.fullmatch(pin), "Exact retained Web outbox plan required")
        return pin


def _handoff(raw):
    require(len(raw) <= _MAX_HANDOFF_BYTES, "Scheduled Web handoff exceeded its bound")
    value = decode(raw)
    require(type(value) is dict and set(value) == {"operationId", "event"} and isinstance(value["operationId"], str)
            and NAME.fullmatch(value["operationId"]) and type(value["event"]) is dict,
            "Exact scheduled Web handoff required")
    pin = value["event"].get("planSha256")
    require(isinstance(pin, str) and HASH.fullmatch(pin), "Exact scheduled Web handoff plan required")
    return pin, read_handoff(io.BytesIO(raw), value["operationId"], pin)


def submit_current(outbox, config, raw, *, report=report_observation):
    """Recover any retained acknowledgement before submitting a later journal."""
    pending = _pending_plan(outbox)
    if pending is not None:
        def no_replacement():
            raise SwitchConflict("Scheduled Web pending batch changed before retry")

        result = report(outbox, config, no_replacement, plan_sha256=pending)
        if result != "accepted":
            return result
    if not raw:
        return "accepted" if pending is not None else "idle"
    pin, event = _handoff(raw)
    result = report(outbox, config, lambda: event, plan_sha256=pin)
    return "accepted" if pending is not None and result == "unchanged" else result


def _reporter(raw, *, account, outbox, config):
    user = pwd.getpwnam(account)
    require(user.pw_name == account and user.pw_uid > 0 and user.pw_gid > 0, "A separate non-root Operations account is required")
    interpreter = Path(sys.executable).resolve(strict=True)
    script = _trusted_source(Path(__file__))
    command = [str(interpreter), "-I", "-B", "-c", _BOOTSTRAP, str(script), "submit-current",
               "--outbox", str(outbox), "--reporter-config", str(config)]
    result = subprocess.run(command, input=raw, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=False,
                            timeout=45, user=user.pw_uid, group=user.pw_gid, extra_groups=(), cwd="/",
                            umask=0o077, env={"PATH": "/usr/bin:/bin"})
    require(result.stdout in {status.encode() + b"\n" for status in _RESULTS}, "Scoped Web reporter response unavailable")
    outcome = result.stdout.decode().strip()
    require(result.returncode == (0 if outcome in _OK else 1), "Scoped Web reporter exit status differs")
    return outcome


def _trusted_source(script):
    script = script.resolve(strict=True)
    for path in (script, *script.parents):
        info = path.stat()
        require(info.st_uid == _RELEASE_UID and not info.st_mode & (stat.S_IWGRP | stat.S_IWOTH),
                "Install the scheduled Web reporter in a root-owned code directory")
    return script


def tick(original, state, *, target_key, account, outbox, config, reporter=_reporter):
    """Read as the release owner and submit exclusively as the collector owner."""
    require(os.geteuid() == _RELEASE_UID and NAME.fullmatch(target_key)
            and all(path.is_absolute() and ".." not in path.parts for path in (original, state, outbox, config)),
            "Exact privileged scheduled Web release inputs required")
    held = False
    try:
        raw = extract_current(original, state, target_key=target_key)
    except _ERRORS:
        # A held release read still gives the collector account a chance to
        # recover a previously retained event, using no new handoff bytes.
        raw, held = b"", True
    result = reporter(raw, account=account, outbox=outbox, config=config)
    return "held" if held and result in _OK else result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="action", required=True)
    extract = commands.add_parser("extract-current", help="Read a locked journal as the release owner")
    submit = commands.add_parser("submit-current", help="Retry the outbox and read trusted stdin as the collector owner")
    schedule = commands.add_parser("tick", help="Read the journal and drop privileges before invoking the collector reporter")
    for command in (extract, schedule):
        command.add_argument("--original", required=True, type=Path)
        command.add_argument("--state", required=True, type=Path)
        command.add_argument("--target-key", required=True)
    for command in (submit, schedule):
        command.add_argument("--outbox", required=True, type=Path)
        command.add_argument("--reporter-config", required=True, type=Path)
    schedule.add_argument("--reporter-user", required=True)
    args = parser.parse_args(argv)
    os.umask(0o077)
    try:
        if args.action == "extract-current":
            sys.stdout.buffer.write(extract_current(args.original, args.state, target_key=args.target_key))
            return 0
        if args.action == "submit-current":
            require(os.geteuid() != _RELEASE_UID, "Run the Web reporter under the separate Operations account")
            result = submit_current(args.outbox, args.reporter_config, _stdin_handoff(sys.stdin.fileno()).read())
        else:
            result = tick(args.original, args.state, target_key=args.target_key, account=args.reporter_user,
                          outbox=args.outbox, config=args.reporter_config)
    except _CLI_ERRORS:
        result = "held"
        if args.action == "extract-current":
            print(result, file=sys.stderr)
            return 1
    print(result)
    return 0 if result in _OK else 1


if __name__ == "__main__":
    raise SystemExit(main())
