"""Deliver one retained availability event from the independent observer host."""

import argparse
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import re
import stat
import subprocess
from urllib.parse import urlsplit

from check_public_availability import _hostname, acknowledge_event, read_observer
from component_inputs import decode
from installed_web_chain import _directory, _private_bytes
from web_switch import canonical


_PATH = re.compile(r"/[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*\Z")
_TOKEN = re.compile(r"[A-Za-z0-9._~+/-]{16,512}={0,2}\Z")
_MAX_REPLY = 1024


def _destination(config):
    raw = _private_bytes(config, modes=(0o400, 0o600))
    if len(raw) > 4096:
        raise ValueError("Bounded availability destination configuration required")
    value = decode(raw)
    if type(value) is not dict or set(value) != {"url", "token"} or type(value["url"]) is not str:
        raise ValueError("Exact availability destination configuration required")
    url, token = value["url"], value["token"]
    target = urlsplit(url)
    if (target.scheme != "https" or target.hostname is None or target.netloc != target.hostname
            or not _PATH.fullmatch(target.path) or len(url) > 512 or url != f"https://{target.hostname}{target.path}"
            or (token is not None and (type(token) is not str or not _TOKEN.fullmatch(token)))):
        raise ValueError("Exact HTTPS availability destination and bounded token required")
    _hostname(target.hostname)
    return url, token


def _deliver(event, *, url, token, curl, run):
    identifier = event["event"]["id"]
    headers = ["Accept: application/json", "Accept-Encoding: identity", "Content-Type: application/json",
               "Cache-Control: no-store", f"Idempotency-Key: {identifier}"]
    if token is not None:
        headers.append(f"Authorization: Bearer {token}")
    # curl config goes on stdin. A bearer token never appears in argv or output.
    def config_value(value):
        return json.dumps(value, ensure_ascii=True)

    options = [f"url = {config_value(url)}", *(f"header = {config_value(value)}" for value in headers),
               f"data-binary = {config_value(canonical(event).decode('ascii'))}"]
    try:
        result = run([curl, "--disable", "--silent", "--noproxy", "*", "--proto", "=https", "--tlsv1.2",
                      "--connect-timeout", "3", "--max-time", "7", "--max-filesize", str(_MAX_REPLY),
                      "--request", "POST", "--write-out", "\n%{http_code}", "--config", "-"],
                     input=("\n".join(options) + "\n").encode(), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                     env={"PATH": os.defpath, "LC_ALL": "C"}, timeout=8, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return False
    body, _, status = result.stdout.rpartition(b"\n")
    if result.returncode != 0 or status not in (b"200", b"202") or len(body) > _MAX_REPLY:
        return False
    try:
        response = decode(body)
        return (type(response) is dict and set(response) == {"eventId", "accepted"}
                and response["eventId"] == identifier and response["accepted"] is True)
    except (ValueError, TypeError, RecursionError):
        return False


@contextmanager
def _delivery_lock(directory):
    _directory(directory)
    parent = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        name = "availability-delivery.lock"
        flags = os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK
        descriptor = os.open(name, flags, 0o600, dir_fd=parent)
        try:
            info = os.fstat(descriptor)
            if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_nlink != 1
                    or stat.S_IMODE(info.st_mode) != 0o600):
                raise ValueError("Private availability delivery lock required")
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            if (not os.path.samestat(info, os.stat(name, dir_fd=parent, follow_symlinks=False))
                    or not os.path.samestat(os.fstat(parent), directory.lstat())):
                raise ValueError("Availability delivery lock authority changed")
            yield
        finally:
            os.close(descriptor)
    finally:
        os.close(parent)


def deliver_next(directory, hostname, config, *, curl="/usr/bin/curl", run=subprocess.run):
    """Send the oldest event with a stable ID and acknowledge only an exact receipt."""
    url, token = _destination(config)
    if urlsplit(url).hostname == hostname:
        raise ValueError("Availability destination must have a separate authority")
    with _delivery_lock(directory):
        current = read_observer(directory, hostname)
        pending = current["pending"]
        if not pending:
            return {"state": "empty", "observerStale": current["stale"]}
        event = pending[0]
        message = {"schemaVersion": 1, "kind": "warpdrive-availability-alert", "hostname": hostname, "event": event}
        if not _deliver(message, url=url, token=token, curl=curl, run=run):
            return {"state": "held", "eventId": event["id"], "observerStale": current["stale"]}
        acknowledge_event(directory, hostname, event["id"])
        return {"state": "accepted", "eventId": event["id"], "observerStale": current["stale"]}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("hostname")
    parser.add_argument("--state-dir", type=Path, required=True)
    parser.add_argument("--config", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        result = deliver_next(args.state_dir, args.hostname, args.config)
    except (OSError, ValueError, TypeError, KeyError, RuntimeError, RecursionError):
        result = {"state": "held"}
    print(json.dumps(result, sort_keys=True))
    if result["state"] == "held":
        return 1
    return 2 if result["observerStale"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
