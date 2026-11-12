"""Confirm a missing manifest from bounded V2 JSON, never CLI error text.

Only GHCR HTTPS and a literal fixture loopback endpoint are supported. Credentials
stay in memory/headers or credential-helper stdin/stdout, never argv or evidence.
Authentication/provider behavior requires separate actual qualification.
"""
from __future__ import annotations

import base64
import binascii
import json
import os
from pathlib import Path
import re
import stat
import subprocess
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

MAX_BYTES = 65536
SEGMENT = re.compile(r"[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*\Z")
TAG = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}\Z")
HELPER = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,63}\Z")


class AbsenceError(RuntimeError):
    """Absence was not established; no raw response, credential or helper error is retained."""


def _require(condition):
    if not condition:
        raise AbsenceError("registry absence evidence is invalid or unavailable")


def _json(raw):
    def unique(pairs):
        value = {}
        for key, item in pairs:
            _require(key not in value)
            value[key] = item
        return value
    try:
        _require(len(raw) <= MAX_BYTES)
        return json.loads(raw, object_pairs_hook=unique, parse_constant=lambda _: _require(False))
    except (ValueError, TypeError, UnicodeError):
        raise AbsenceError("registry metadata is invalid") from None


def _target(tag):
    _require(isinstance(tag, str) and 1 <= len(tag) <= 512 and "/" in tag and "@" not in tag)
    host, path = tag.split("/", 1)
    if host == "ghcr.io":
        scheme = "https"
    else:
        match = re.fullmatch(r"127\.0\.0\.1:([0-9]{1,5})", host)
        _require(match is not None and 1 <= int(match[1]) <= 65535 and str(int(match[1])) == match[1])
        scheme = "http"
    _require(":" in path)
    repository, version = path.rsplit(":", 1)
    _require(1 <= len(repository) <= 255 and all(SEGMENT.fullmatch(part) for part in repository.split("/"))
             and TAG.fullmatch(version))
    return host, repository, f"{scheme}://{host}/v2/{repository}/manifests/{version}"


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *arguments):
        raise AbsenceError("registry redirects are not permitted")


def _get(opener, url, headers):
    try:
        request = Request(url, headers=headers, method="GET")
        try:
            response = opener.open(request, timeout=10)
        except HTTPError as error:
            response = error
        with response:
            _require(response.geturl() == url)
            raw = response.read(MAX_BYTES + 1)
            _require(len(raw) <= MAX_BYTES)
            return response.getcode(), response.headers, raw
    except AbsenceError:
        raise
    except Exception:
        raise AbsenceError("registry transport outcome is unavailable") from None


def _scope(challenge, repository):
    _require(isinstance(challenge, str) and 0 < len(challenge) <= 2048 and "\r" not in challenge and "\n" not in challenge)
    prefix = re.match(r"(?i:Bearer)[ \t]+", challenge)
    _require(prefix is not None)
    fields, offset = {}, prefix.end()
    while offset < len(challenge):
        match = re.match(r'[ \t]*([A-Za-z]+)="([^"\\]*)"[ \t]*(,|$)', challenge[offset:])
        _require(match is not None and len(fields) < 3)
        key = match[1].lower()
        _require(key not in fields)
        fields[key] = match[2]
        offset += match.end()
        _require(match[3] != "," or offset < len(challenge))
    _require(set(fields) == {"realm", "service", "scope"} and fields["realm"] == "https://ghcr.io/token"
             and fields["service"] == "ghcr.io"
             and fields["scope"] in {f"repository:{repository}:pull", f"repository:{repository}:pull,push"})
    return fields["scope"]


def _docker_config(environment):
    """Read only the existing bounded regular Docker config through the safe file boundary."""
    _require(isinstance(environment, dict))
    directory = environment.get("DOCKER_CONFIG")
    if not directory:
        home = environment.get("HOME")
        _require(isinstance(home, str) and Path(home).is_absolute())
        directory = str(Path(home) / ".docker")
    _require(isinstance(directory, str) and Path(directory).is_absolute())
    try:
        path = Path(directory) / "config.json"
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
        with os.fdopen(descriptor, "rb") as source:
            metadata = os.fstat(source.fileno())
            _require(stat.S_ISREG(metadata.st_mode) and metadata.st_size <= MAX_BYTES)
            config = _json(source.read(MAX_BYTES + 1))
    except AbsenceError:
        raise
    except Exception:
        raise AbsenceError("existing Docker credentials are unavailable") from None
    _require(isinstance(config, dict))
    return config


def _credentials(environment, runner):
    config = _docker_config(environment)
    helpers = config.get("credHelpers", {})
    _require(isinstance(helpers, dict))
    helper = helpers.get("ghcr.io") or config.get("credsStore")
    if helper:
        _require(isinstance(helper, str) and HELPER.fullmatch(helper))
        try:
            result = runner(["docker-credential-" + helper, "get"], input="ghcr.io", capture_output=True,
                            text=True, check=False, timeout=10,
                            env={key: value for key, value in environment.items() if key in {
                                "PATH", "HOME", "DOCKER_CONFIG", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS",
                                "PASSWORD_STORE_DIR", "GNUPGHOME", "GPG_TTY"}})
            _require(result.returncode == 0 and isinstance(result.stdout, str)
                     and len(result.stdout.encode()) <= MAX_BYTES and len((result.stderr or "").encode()) <= MAX_BYTES)
            value = _json(result.stdout)
            # The documented get response needs only Username and Secret. Some
            # helpers also echo ServerURL; if present it must retain our stdin target.
            _require(isinstance(value, dict) and ("ServerURL" not in value or value["ServerURL"] == "ghcr.io"))
            username, secret = value.get("Username"), value.get("Secret")
        except AbsenceError:
            raise
        except Exception:
            raise AbsenceError("existing Docker credential helper is unavailable") from None
    else:
        auths = config.get("auths", {})
        _require(isinstance(auths, dict) and isinstance(auths.get("ghcr.io"), dict))
        encoded = auths["ghcr.io"].get("auth")
        _require(isinstance(encoded, str) and len(encoded) <= MAX_BYTES)
        try:
            decoded = base64.b64decode(encoded, validate=True).decode("utf-8")
            username, secret = decoded.split(":", 1)
        except (ValueError, UnicodeError, binascii.Error):
            raise AbsenceError("existing Docker credential encoding is invalid") from None
    _require(isinstance(username, str) and isinstance(secret, str) and username and secret
             and username != "<token>" and len(username) + len(secret) <= 16384
             and not any(character in username + secret for character in "\r\n\0"))
    return base64.b64encode((username + ":" + secret).encode()).decode("ascii")


def _missing(status, raw):
    _require(status == 404)
    value = _json(raw)
    _require(isinstance(value, dict) and set(value) == {"errors"} and isinstance(value["errors"], list)
             and len(value["errors"]) == 1 and isinstance(value["errors"][0], dict)
             and value["errors"][0].get("code") == "MANIFEST_UNKNOWN")


def confirm_absent(tag, *, environment, runner=subprocess.run, opener=None):
    """Return only on one exact structured MANIFEST_UNKNOWN404; otherwise hold."""
    host, repository, url = _target(tag)
    transport = opener or build_opener(ProxyHandler({}), _NoRedirect())
    headers = {"Accept": "application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json"}
    status, response_headers, raw = _get(transport, url, headers)
    _require(host != "ghcr.io" or status == 401)
    if status == 401:
        _require(host == "ghcr.io")  # Never resolve or send Docker credentials to a local fixture.
        challenges = response_headers.get_all("WWW-Authenticate") if hasattr(response_headers, "get_all") else [response_headers.get("WWW-Authenticate")]
        _require(isinstance(challenges, list) and len(challenges) == 1)
        scope = _scope(challenges[0], repository)
        authorization = _credentials(environment, runner)
        token_url = "https://ghcr.io/token?" + urlencode({"service": "ghcr.io", "scope": scope})
        token_status, _, token_raw = _get(transport, token_url, {"Accept": "application/json", "Authorization": "Basic " + authorization})
        _require(token_status == 200)
        document = _json(token_raw)
        _require(isinstance(document, dict))
        token = document.get("token", document.get("access_token"))
        _require(isinstance(token, str) and 0 < len(token) <= 16384 and re.fullmatch(r"[A-Za-z0-9._~+/-]+=*", token)
                 and ("token" not in document or "access_token" not in document or document["token"] == document["access_token"]))
        status, _, raw = _get(transport, url, {**headers, "Authorization": "Bearer " + token})
    _missing(status, raw)
