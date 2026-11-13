"""Credential-free public readback for the installed Traefik Web handoff."""
from __future__ import annotations

import base64
from dataclasses import dataclass
import hashlib
from http.client import HTTPException, HTTPSConnection
from ipaddress import ip_address
import json
import re
import secrets
import socket
import ssl
import threading
from typing import Callable

from caddy_core_config import CORE_PROBE_HEADER, CORE_READ_PATH, CORE_RESPONSE_HEADER, CORE_RESPONSE_MARKER
from caddy_web_config import PROBE_REQUEST_HEADER, PROBE_RESPONSE_HEADER
from traefik_web_handoff_state import HandoffObservation


IDENTITY_PATH = "/api/runtime/web-identity"
HEALTH_PATH = "/api/health"
POST_PATH = "/board"
WS_PATH = "/_ws"
STORAGE_PATH = "/warpdrive"
POST_ACTION = "0" * 42
REJECTION_HEADER = "X-Warpdrive-Web-Rejection"
REJECTION_BODY = b"Refresh this page before submitting again.\n"
WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
BODY_LIMIT = 1024
HOST_LABEL = re.compile(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\Z")
RELAY_ALIAS = re.compile(r"warpdrive-web-relay-[a-f0-9]{12}\Z")
RUNTIME_ID = re.compile(r"[a-f0-9]{64}\Z")
REVISION = re.compile(r"[a-f0-9]{40}\Z")
VERSION = re.compile(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?(?:\+[a-zA-Z0-9.-]+)?\Z")
UPSTREAM = re.compile(r"http://[a-z0-9.-]+:[0-9]{1,5}\Z")


class ProbeError(ValueError):
    """A fixed-scope request or its bounded response could not be verified."""


def _require(condition, message):
    if not condition:
        raise ProbeError(message)


def _hostname(value):
    return (isinstance(value, str) and 1 < len(value) <= 253 and "." in value
            and all(HOST_LABEL.fullmatch(label) for label in value.split(".")))


@dataclass(frozen=True)
class Endpoint:
    """Use an independently pinned connect address and verify the public TLS name."""

    host: str
    address: str
    port: int = 443

    def __post_init__(self):
        _require(_hostname(self.host), "Exact public TLS hostname required")
        try:
            address = ip_address(self.address)
        except ValueError:
            raise ProbeError("An exact numeric connect address is required") from None
        _require(str(address) == self.address and not address.is_unspecified and not address.is_multicast
                 and "%" not in self.address and type(self.port) is int and 1 <= self.port <= 65535,
                 "Canonical numeric TLS endpoint required")


@dataclass(frozen=True)
class Response:
    status: int
    headers: tuple[tuple[str, str], ...]
    body: bytes

    def values(self, name):
        return tuple(value for key, value in self.headers if key.lower() == name.lower())


class TlsProbe:
    """No DNS, proxy, redirects, credentials, decompression or automatic replay."""

    def __init__(self, endpoint: Endpoint, *, cafile=None, timeout=5):
        _require(type(timeout) in (int, float) and 0 < timeout <= 10, "Finite TLS probe timeout required")
        self.endpoint = endpoint
        self.context = ssl.create_default_context(cafile=cafile)
        self.context.minimum_version = ssl.TLSVersion.TLSv1_2
        self.context.set_alpn_protocols(["http/1.1"])
        self.timeout = timeout

    def __call__(self, method, path, headers, *, read_body):
        _require((method, path) in {("GET", IDENTITY_PATH), ("GET", HEALTH_PATH), ("GET", CORE_READ_PATH),
                                   ("POST", POST_PATH), ("GET", WS_PATH), ("GET", STORAGE_PATH)},
                 "Public probe request is outside its fixed scope")
        allowed = {"accept", "cache-control", "content-length", "connection", "next-action", "origin",
                   "sec-websocket-key", "sec-websocket-version", "upgrade", PROBE_REQUEST_HEADER.lower(), CORE_PROBE_HEADER.lower()}
        _require(all(isinstance(name, str) and name.lower() in allowed and isinstance(value, str)
                     and 0 < len(value) <= 256 and all(32 <= ord(ch) < 127 for ch in value)
                     for name, value in headers.items())
                 and len(headers) == len({name.lower() for name in headers}), "Public probe headers are out of scope")
        connection = HTTPSConnection(self.endpoint.host, self.endpoint.port, context=self.context, timeout=self.timeout)
        peer = ip_address(self.endpoint.address)
        raw = socket.socket(socket.AF_INET if peer.version == 4 else socket.AF_INET6, socket.SOCK_STREAM)
        raw.settimeout(self.timeout)
        expired = threading.Event()
        tls = None

        def stop():
            expired.set()
            for active in (raw, tls, connection.sock):
                if active is not None:
                    try:
                        active.shutdown(socket.SHUT_RDWR)
                    except OSError:
                        pass

        # HTTPSConnection still performs standard certificate and SNI verification
        # with the public name. Only the TCP connect target is independently pinned.
        def connect(_authority, _timeout, _source):
            raw.connect((str(peer), self.endpoint.port))
            return raw

        connection._create_connection = connect
        timer = threading.Timer(self.timeout, stop)
        timer.start()
        try:
            connection.connect()
            tls = connection.sock
            _require(tls.version() in {"TLSv1.2", "TLSv1.3"} and not expired.is_set(), "Bounded TLS 1.2 or newer required")
            connection.request(method, path, body=b"" if method == "POST" else None,
                               headers={"Host": self.endpoint.host, "Accept-Encoding": "identity", **headers})
            with connection.getresponse() as response:
                values = tuple(response.getheaders())
                content = response.read(BODY_LIMIT + 1) if read_body else b""
                _require(len(content) <= BODY_LIMIT and not expired.is_set(), "Public probe response exceeded its bound")
                return Response(response.status, values, content)
        finally:
            timer.cancel()
            connection.close()
            raw.close()


@dataclass(frozen=True)
class RouteHints:
    """Trusted active routing or per-request connection observations supplied by the operator.

    Each value identifies the upstream for the exact method/path below. A watched
    file, Docker labels, or an uncorrelated public success cannot supply these facts.
    """

    edge_runtime_id: str
    safe_upstream: str
    unsafe_upstream: str
    realtime_upstream: str


@dataclass(frozen=True)
class PublicProbe:
    safe_hop: str | None
    unsafe_hop: str | None
    identity_matches: bool | None
    unstamped_rejected: bool | None
    websocket_upgrade: bool | None
    websocket_direct: bool | None
    storage_anonymous_denied: bool | None

    def handoff_observation(self, *, peers_unchanged: bool | None) -> HandoffObservation:
        public = _combined(self.identity_matches, self.unstamped_rejected, self.storage_anonymous_denied)
        websocket = _combined(self.websocket_upgrade, self.websocket_direct)
        return HandoffObservation(self.safe_hop, self.unsafe_hop, public, websocket, peers_unchanged)


def _combined(*facts):
    if False in facts:
        return False
    return None if None in facts else True


def _unique(pairs):
    result = dict(pairs)
    _require(len(pairs) == len(result), "Duplicate Web identity field")
    return result


def _single(response, name):
    values = response.values(name)
    return values[0] if len(values) == 1 else None


def _no_store(response):
    value = _single(response, "Cache-Control")
    return value is not None and "no-store" in {part.strip().lower() for part in value.split(",")}


def _identity_matches(response, revision, version):
    if response is None:
        return None
    media = _single(response, "Content-Type")
    if (response.status != 200 or media is None or media.split(";", 1)[0].strip().lower() != "application/json"
            or not _no_store(response) or response.values("Content-Encoding") not in ((), ("identity",))):
        return False
    try:
        observed = json.loads(response.body.decode("utf-8"), object_pairs_hook=_unique)
    except (ValueError, RecursionError):
        return False
    return observed == {"contract": "warpdrive.web.identity.v1", "component": "web", "version": version,
                        "sourceRevision": revision}


def _unstamped_rejected(response):
    if response is None:
        return None
    return (response.status == 409 and _single(response, REJECTION_HEADER) == "before-forward" and _no_store(response)
            and response.values("Content-Encoding") in ((), ("identity",)) and response.body == REJECTION_BODY)


def _websocket_upgrade(response, key):
    if response is None:
        return None
    # SHA-1 is fixed by the RFC 6455 upgrade protocol and confers no authentication.
    expected = base64.b64encode(hashlib.sha1((key + WS_GUID).encode("ascii"), usedforsecurity=False).digest()).decode("ascii")
    connection = _single(response, "Connection")
    upgrade = _single(response, "Upgrade")
    return (response.status == 101 and connection is not None
            and "upgrade" in {part.strip().lower() for part in connection.split(",")}
            and upgrade is not None and upgrade.lower() == "websocket" and _single(response, "Sec-WebSocket-Accept") == expected
            and not response.values(PROBE_RESPONSE_HEADER) and not response.values("Sec-WebSocket-Protocol")
            and not response.values("Sec-WebSocket-Extensions"))


def _hop(response, proof, observed, incumbent, successor, alias):
    if response is None:
        return None
    marker = response.values(PROBE_RESPONSE_HEADER)
    # The operation marker establishes the responding relay independently of
    # whether the expected application identity or rejection contract is healthy.
    if marker == (alias,) and observed in (None, successor):
        return "after"
    if not marker and proof is True and observed == incumbent:
        return "before"
    return None


def _request(request, method, path, headers, *, read_body):
    try:
        result = request(method, path, headers, read_body=read_body)
        if type(result) is Response and type(result.body) is bytes and len(result.body) <= BODY_LIMIT:
            return result
    except (OSError, HTTPException, ProbeError):
        pass
    return None


def read_public_core_route(request, *, active=True):
    """Observe one anonymous protected read through the exact Core proxy route."""
    response = _request(request, "GET", CORE_READ_PATH,
        {"Accept": "application/json", "Cache-Control": "no-cache", CORE_PROBE_HEADER: CORE_RESPONSE_MARKER}, read_body=True)
    marker = (CORE_RESPONSE_MARKER,) if active else ()
    if response is None or response.status != 401 or response.values(CORE_RESPONSE_HEADER) != marker:
        return False
    media = response.values("Content-Type")
    if (len(media) != 1 or media[0].split(";", 1)[0].strip().lower() != "application/json"
            or response.values("Content-Encoding") not in ((), ("identity",))
            or (active and response.values("Cache-Control") != ("no-store",))):
        return False
    try:
        value = json.loads(response.body.decode("utf-8"), object_pairs_hook=_unique)
        return value["error"]["json"]["data"]["code"] == "UNAUTHORIZED"
    except (ValueError, TypeError, KeyError, RecursionError):
        return False


def _hints(read, runtime):
    if read is None:
        return None
    try:
        observed = read()
    except (OSError, ValueError, RuntimeError):
        return None
    if (type(observed) is RouteHints and observed.edge_runtime_id == runtime
            and all(isinstance(upstream, str) and UPSTREAM.fullmatch(upstream) for upstream in
                    (observed.safe_upstream, observed.unsafe_upstream, observed.realtime_upstream))):
        return observed
    return None


def probe_public(
    web, storage, *, host, storage_host, revision, version, successor_alias, incumbent_upstream,
    successor_upstream, realtime_upstream, edge_runtime_id,
    read_route_hints: Callable[[], RouteHints | None] | None = None,
):
    """Probe public HTTPS once per path and return finite facts without HTTP contents."""
    _require(_hostname(host) and _hostname(storage_host) and host != storage_host
             and isinstance(revision, str) and REVISION.fullmatch(revision)
             and isinstance(version, str) and len(version) <= 128 and VERSION.fullmatch(version)
             and isinstance(successor_alias, str) and RELAY_ALIAS.fullmatch(successor_alias)
             and isinstance(edge_runtime_id, str) and RUNTIME_ID.fullmatch(edge_runtime_id)
             and all(isinstance(item, str) and UPSTREAM.fullmatch(item)
                     for item in (incumbent_upstream, successor_upstream, realtime_upstream))
             and len({incumbent_upstream, successor_upstream, realtime_upstream}) == 3,
             "Exact public Web release and upstream pins required")
    _require(not isinstance(web, TlsProbe) or web.endpoint.host == host, "Web probe TLS authority differs")
    _require(not isinstance(storage, TlsProbe) or storage.endpoint.host == storage_host, "Storage probe TLS authority differs")
    before = _hints(read_route_hints, edge_runtime_id)
    marker = {PROBE_REQUEST_HEADER: successor_alias, "Cache-Control": "no-cache"}
    identity = _request(web, "GET", IDENTITY_PATH, {**marker, "Accept": "application/json"}, read_body=True)
    rejected = _request(web, "POST", POST_PATH, {**marker, "Content-Length": "0", "Next-Action": POST_ACTION},
                        read_body=True)
    key = base64.b64encode(secrets.token_bytes(16)).decode("ascii")
    websocket = _request(web, "GET", WS_PATH, {"Connection": "Upgrade", "Upgrade": "websocket",
                         "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": key, "Origin": "https://" + host},
                         read_body=False)
    silo = _request(storage, "GET", STORAGE_PATH, {"Cache-Control": "no-cache"}, read_body=False)
    after = _hints(read_route_hints, edge_runtime_id)
    stable = before if before == after else None
    identity_ok = _identity_matches(identity, revision, version)
    rejected_ok = _unstamped_rejected(rejected)
    ws_ok = _websocket_upgrade(websocket, key)
    # An ordinary application can return the same healthy identity directly;
    # without positive live topology, an unmarked response says nothing about A.
    safe = _hop(identity, identity_ok, stable.safe_upstream if stable else None,
                incumbent_upstream, successor_upstream, successor_alias)
    unsafe = _hop(rejected, rejected_ok, stable.unsafe_upstream if stable else None,
                  incumbent_upstream, successor_upstream, successor_alias)
    if before != after:
        safe = unsafe = None
    direct = None if stable is None else stable.realtime_upstream == realtime_upstream
    storage_denied = None if silo is None else silo.status == 403
    return PublicProbe(safe, unsafe, identity_ok, rejected_ok, ws_ok, direct, storage_denied)
