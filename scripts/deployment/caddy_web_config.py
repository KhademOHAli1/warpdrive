"""Compile the admitted installed Caddy Web relay handoff and generation switch.

The operator authenticates the installed bytes, generation and endpoint bindings
and owns deployment. These functions perform no filesystem or network operations.
"""

from copy import deepcopy
import hashlib
import json
import re

from traefik_web_relay import _caddy_config, _label, _peer_network
from web_generation_routes import WebGeneration, compile_web_generation_routes


ADMIN_SOCKET = "/run/warpdrive-admin/control.sock"
PROBE_REQUEST_HEADER = "X-Warpdrive-Web-Relay-Probe"
PROBE_RESPONSE_HEADER = "X-Warpdrive-Web-Relay"
_RELAY_ALIAS = re.compile(r"warpdrive-web-relay-[a-f0-9]{12}\Z")
_SHA256 = re.compile(r"[a-f0-9]{64}\Z")
_MAX_BYTES = 1024 * 1024


def _require(condition, reason):
    if not condition:
        raise ValueError(reason)


def _unique_object(pairs):
    result = dict(pairs)
    _require(len(result) == len(pairs), "Duplicate installed Caddy JSON property")
    return result


def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def _read_installed(raw, expected_sha256):
    _require(type(raw) is bytes and 0 < len(raw) <= _MAX_BYTES and isinstance(expected_sha256, str)
             and _SHA256.fullmatch(expected_sha256) and hashlib.sha256(raw).hexdigest() == expected_sha256,
             "Independently pinned installed Caddy bytes required")
    try:
        return _canonical(json.loads(raw.decode("utf-8"), object_pairs_hook=_unique_object))
    except (ValueError, RecursionError):
        raise ValueError("Invalid installed Caddy JSON") from None


def _generation_handler(document):
    return document["apps"]["http"]["servers"]["web-relay"]["routes"][0]["handle"][0]


def _probe_marker(alias):
    # This route runs under the existing host/Traefik peer gate and only adds a
    # response header. The original terminal routes still decide every request.
    expression = (
        f"{{http.request.header.{PROBE_REQUEST_HEADER}}} == '{alias}'"
        " && !header({'Authorization': '*'}) && !header({'Cookie': '*'})"
        " && !header({'X-Deployment-Id': '*'}) && {http.request.uri.query} == ''"
        " && ((method('GET') && {http.request.uri.path} == '/api/runtime/web-identity'"
        " && !header({'Next-Action': '*'}))"
        " || (method('POST') && {http.request.uri.path} == '/board'"
        " && {http.request.header.Content-Length} == '0'"
        " && {http.request.header.Next-Action}.matches('^[a-f0-9]{42}$')))"
    )
    return {"match": [{"expression": expression}], "handle": [{"handler": "headers", "response": {
        "deferred": True, "set": {PROBE_RESPONSE_HEADER: [alias]},
    }}]}


def compile_successor_web_configs(installed_bytes, *, expected_sha256, host, traefik_ip,
                                  installed_relay_alias, successor_relay_alias, current, candidate,
                                  admin_socket=ADMIN_SOCKET):
    """Return ``successorA`` and ``successorB`` configs from exact stamped A input.

    A keeps the original generation handlers. B changes only that handler to
    the existing two-generation policy. The operation alias is a probe marker,
    never authentication or authority to bypass the generation rules.
    """
    _require(isinstance(host, str) and "." in host and len(host) <= 253 and all(_label(part) for part in host.split(".")),
             "Exact public Web host required")
    aliases = (installed_relay_alias, successor_relay_alias)
    _require(all(isinstance(alias, str) and _RELAY_ALIAS.fullmatch(alias) for alias in aliases)
             and len(set(aliases)) == 2, "Distinct admitted relay aliases required")
    _require(str(admin_socket) == ADMIN_SOCKET, "Fixed private Caddy admin socket required")
    _require(isinstance(current, WebGeneration) and isinstance(candidate, WebGeneration)
             and current.target == "app" and candidate.target not in (*aliases, current.target),
             "Exact installed and distinct candidate Web generation bindings required")
    peer = _peer_network(traefik_ip)
    baseline = _caddy_config(host, peer, compile_web_generation_routes(current=current))
    _require(_read_installed(installed_bytes, expected_sha256) == _canonical(baseline),
             "Installed Caddy config differs from the admitted stamped generation")

    successor_a = deepcopy(baseline)
    successor_a["admin"] = {"listen": f"unix/{ADMIN_SOCKET}|0600", "config": {"persist": True}}
    marker = _probe_marker(successor_relay_alias)
    _generation_handler(successor_a)["routes"].insert(0, marker)
    both = _caddy_config(host, peer, compile_web_generation_routes(current=candidate, previous=current))
    successor_b = deepcopy(successor_a)
    _generation_handler(successor_b)["routes"] = [deepcopy(marker), *_generation_handler(both)["routes"]]
    return {"successorA": successor_a, "successorB": successor_b}
