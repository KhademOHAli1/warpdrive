"""Journal a scoped Traefik file change and verify its live application."""

from collections.abc import Callable
from contextlib import contextmanager
from dataclasses import dataclass
import fcntl
import json
import os
from pathlib import Path
from secrets import token_hex
import stat

from traefik_web_handoff import TraefikWebHandoff, compile_traefik_web_handoff


ROUTE_FILE = "warpdrive-web-relay.yaml"
JOURNAL_FILE = "traefik-web-handoff.json"
_MAX_ROUTE = 64 * 1024
_MAX_JOURNAL = 4096
_DIRECTORY_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
_STATES = {"switch-intent", "switch-acknowledged", "accepted", "rollback-intent", "rolled-back"}


class HandoffConflict(ValueError):
    """The operation or its protected inputs differ from the admitted plan."""


class HandoffHeld(RuntimeError):
    """A recorded mutation needs further observation before any new action."""


@dataclass(frozen=True)
class HandoffObservation:
    """Both hops are independently identified as before/after, or unknown."""

    safe_hop: str | None
    unsafe_hop: str | None
    public_healthy: bool | None
    websocket_healthy: bool | None
    peers_unchanged: bool | None

    def at(self, side):
        return self.safe_hop == self.unsafe_hop == side

    def healthy_at(self, side):
        return self.at(side) and all(result is True for result in (
            self.public_healthy, self.websocket_healthy, self.peers_unchanged,
        ))


def _require(condition, message):
    if not condition:
        raise HandoffConflict(message)


def _identity(info):
    return info.st_dev, info.st_ino


def _witness(info):
    return (*_identity(info), info.st_size, info.st_mtime_ns, info.st_ctime_ns, info.st_nlink)


@contextmanager
def _locked_directory(path):
    path = Path(path)
    _require(path.is_absolute() and path.resolve(strict=True) == path, "Canonical private handoff directory required")
    fd = os.open(path, _DIRECTORY_FLAGS)
    try:
        info = os.fstat(fd)
        _require(info.st_uid == os.geteuid() and stat.S_IMODE(info.st_mode) == 0o700,
                 "Owner-only handoff directory required")
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise HandoffConflict("Another operation owns the handoff directory") from None
        _same_directory(path, fd)
        yield fd
    finally:
        os.close(fd)


def _same_directory(path, fd):
    info = os.stat(path, follow_symlinks=False)
    _require(_identity(info) == _identity(os.fstat(fd)) and info.st_uid == os.geteuid()
             and stat.S_IMODE(info.st_mode) == 0o700, "Handoff directory changed while locked")


def _read(fd, name, *, mode, maximum, links, missing=False):
    try:
        handle = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
    except FileNotFoundError:
        if missing:
            return None
        raise
    with os.fdopen(handle, "rb") as stream:
        initial = os.fstat(stream.fileno())
        _require(stat.S_ISREG(initial.st_mode) and initial.st_uid == os.geteuid()
                 and stat.S_IMODE(initial.st_mode) == mode and initial.st_nlink in links
                 and 0 < initial.st_size <= maximum, "Protected handoff file differs")
        raw = stream.read(initial.st_size + 1)
        _require(len(raw) == initial.st_size and _witness(initial) == _witness(os.fstat(stream.fileno()))
                 == _witness(os.stat(name, dir_fd=fd, follow_symlinks=False)), "Handoff file changed while read")
    return raw, _witness(initial)


def _route(fd):
    # The initial installer hard-links its sealed source to this watched name.
    return _read(fd, ROUTE_FILE, mode=0o644, maximum=_MAX_ROUTE, links=(1, 2))


def _journal(fd):
    return _read(fd, JOURNAL_FILE, mode=0o600, maximum=_MAX_JOURNAL, links=(1,), missing=True)


def _replace(fd, name, raw, mode, *, reread, expected):
    # The file provider only loads supported config suffixes; this staging file
    # is written and synced before a same-directory atomic replacement.
    temporary = f".warpdrive-handoff-{token_hex(12)}.tmp"
    handle = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
    try:
        with os.fdopen(handle, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fchmod(stream.fileno(), mode)
            os.fsync(stream.fileno())
        _require(reread(fd) == expected, "Handoff target changed before atomic replacement")
        os.replace(temporary, name, src_dir_fd=fd, dst_dir_fd=fd)
        os.fsync(fd)
    finally:
        try:
            os.unlink(temporary, dir_fd=fd)
        except FileNotFoundError:
            pass


def _journal_bytes(binding, state):
    return json.dumps({**binding, "state": state}, sort_keys=True, separators=(",", ":")).encode("ascii") + b"\n"


def _journal_state(snapshot, binding):
    if snapshot is None:
        return None
    raw, _ = snapshot
    try:
        state = json.loads(raw)["state"]
    except (ValueError, TypeError, KeyError, RecursionError):
        raise HandoffConflict("Invalid handoff journal") from None
    _require(isinstance(state, str) and state in _STATES and raw == _journal_bytes(binding, state),
             "Handoff journal differs from the admitted operation")
    return state


def _alias(raw):
    try:
        url = json.loads(raw)["http"]["services"]["warpdrive-web-relay-safe"]["loadBalancer"]["servers"][0]["url"]
        return url.removeprefix("http://").removesuffix(":8080")
    except (ValueError, TypeError, KeyError, IndexError, AttributeError, RecursionError):
        raise HandoffConflict("Invalid compiled Web handoff document") from None


def _validate(handoff):
    _require(type(handoff) is TraefikWebHandoff and all(
        isinstance(raw, bytes) and 0 < len(raw) <= _MAX_ROUTE
        for raw in (handoff.before_document, handoff.after_document)
    ), "Bounded compiled Web handoff required")
    compiled = compile_traefik_web_handoff(
        handoff.before_document, expected_sha256=handoff.before_sha256,
        original_alias=_alias(handoff.before_document), successor_alias=_alias(handoff.after_document),
    )
    _require(handoff == compiled, "Web handoff bytes differ from the compiled two-URL change")


def _binding(handoff, watched):
    return {"kind": "warpdrive-traefik-web-handoff", "schemaVersion": 1,
            "watchedDirectory": list(_identity(os.fstat(watched))),
            "beforeSha256": handoff.before_sha256, "afterSha256": handoff.after_sha256}


def verify_accepted_traefik_web_handoff(handoff, *, watched_dir, state_dir):
    """Read back the exact accepted watched file and its durable journal."""
    _validate(handoff)
    with _locked_directory(watched_dir) as watched, _locked_directory(state_dir) as journal_dir:
        _require(_journal_state(_journal(journal_dir), _binding(handoff, watched)) == "accepted"
                 and _route(watched)[0] == handoff.after_document,
                 "Accepted Traefik handoff or its watched route differs")


def apply_traefik_web_handoff(
    handoff: TraefikWebHandoff, *, watched_dir: Path, state_dir: Path,
    observe: Callable[[], HandoffObservation], retained_before_healthy: Callable[[], bool] | None = None,
) -> dict:
    """Apply or reconcile one handoff in its authoritative private state directory.

    All writers must respect the watched-directory lock. The trusted caller
    independently authenticates both relay identities and supplies bounded live
    observations. False public health permits compensation only for a definite
    successor failure, with both exact successor hops and the other checks proven.
    """
    _validate(handoff)
    with _locked_directory(watched_dir) as watched, _locked_directory(state_dir) as journal_dir:
        binding = _binding(handoff, watched)
        journal = _journal(journal_dir)
        state = _journal_state(journal, binding)
        route = _route(watched)
        before, after = handoff.before_document, handoff.after_document

        def unchanged():
            _same_directory(watched_dir, watched)
            _same_directory(state_dir, journal_dir)
            _require(_route(watched) == route and _journal(journal_dir) == journal,
                     "Handoff file or journal changed during the operation")

        def advance(next_state):
            nonlocal journal, state
            unchanged()
            raw = _journal_bytes(binding, next_state)
            _replace(journal_dir, JOURNAL_FILE, raw, 0o600, reread=_journal, expected=journal)
            journal = _journal(journal_dir)
            _require(journal is not None and journal[0] == raw, "Durable handoff journal readback differs")
            state = next_state

        def replace_route(raw):
            nonlocal route
            unchanged()
            _replace(watched, ROUTE_FILE, raw, 0o644, reread=_route, expected=route)
            route = _route(watched)
            _require(route[0] == raw, "Durable watched file readback differs")

        def live():
            unchanged()
            proof = observe()
            unchanged()
            _require(type(proof) is HandoffObservation and all(
                hop in (None, "before", "after") for hop in (proof.safe_hop, proof.unsafe_hop)
            ) and all(result is None or type(result) is bool for result in (
                proof.public_healthy, proof.websocket_healthy, proof.peers_unchanged,
            )), "Invalid independent Traefik live observation")
            return proof

        def receipt():
            return {"kind": binding["kind"], "schemaVersion": 1, "state": state,
                    "beforeSha256": handoff.before_sha256, "afterSha256": handoff.after_sha256,
                    "activeSha256": handoff.after_sha256 if state == "accepted" else handoff.before_sha256}

        if state is None:
            _require(route[0] == before, "Initial installed Traefik file differs from the pinned preimage")
            _require(live().healthy_at("before"), "Initial live Traefik route is unverified")
            advance("switch-intent")
            replace_route(after)
            advance("switch-acknowledged")

        if state in ("accepted", "rolled-back", "rollback-intent"):
            side, raw = ("after", after) if state == "accepted" else ("before", before)
            if route[0] != raw or not live().healthy_at(side):
                raise HandoffHeld("Recorded Traefik route is not yet confirmed live")
            if state == "rollback-intent":
                os.fsync(watched)
                advance("rolled-back")
            return receipt()

        if route[0] != after:
            raise HandoffHeld("Forward file replacement is unresolved; observation only")
        proof = live()
        if proof.healthy_at("after"):
            os.fsync(watched)
            advance("accepted")
            return receipt()

        if (state != "switch-acknowledged" or not proof.at("after") or proof.public_healthy is not False
                or proof.websocket_healthy is not True or proof.peers_unchanged is not True
                or retained_before_healthy is None or retained_before_healthy() is not True):
            raise HandoffHeld("Successor Traefik hops or health are unresolved; observation only")
        if live() != proof:
            raise HandoffHeld("Live Traefik proof changed before rollback")
        advance("rollback-intent")
        replace_route(before)
        if not live().healthy_at("before"):
            raise HandoffHeld("Restored Traefik file is awaiting independent live verification")
        advance("rolled-back")
        return receipt()
