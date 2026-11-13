"""Compile the two upstream changes for the installed CRM Web relay file.

The caller owns the watched file, relay identities, and active Traefik readback.
The direct Realtime route is supplied by the separate Docker provider.
"""

from dataclasses import dataclass
from hashlib import sha256
import json
import re


_ALIAS = re.compile(r"warpdrive-web-relay-[a-f0-9]{12}")
_SHA256 = re.compile(r"[a-f0-9]{64}")
_MAX_DOCUMENT_BYTES = 64 * 1024
_HOST = "crm.pitant.de"
_WEB_RULE = f"Host(`{_HOST}`)"
_SAFE_METHOD = "(Method(`GET`) || Method(`HEAD`))"
_SAFE_ROUTE = "warpdrive-web-relay-safe"
_UNSAFE_ROUTE = "warpdrive-web-relay-unsafe"
_ROUTES = (_SAFE_ROUTE, _UNSAFE_ROUTE)


@dataclass(frozen=True)
class TraefikWebHandoff:
    before_document: bytes
    before_sha256: str
    after_document: bytes
    after_sha256: str


def _unique_object(pairs):
    value = dict(pairs)
    if len(value) != len(pairs):
        raise ValueError("Duplicate installed Traefik JSON key")
    return value


def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("ascii") + b"\n"


def _upstream(alias):
    return f"http://{alias}:8080"


def _installed_overlay(alias):
    # This profile is the exact installed contract, including the forwarded
    # HTTPS health probe and the Docker middleware references.
    routers, services = {}, {}
    for name in _ROUTES:
        unsafe = name == _UNSAFE_ROUTE
        method = f"!{_SAFE_METHOD}" if unsafe else _SAFE_METHOD
        routers[name] = {
            "rule": f"{_WEB_RULE} && {method}",
            "entryPoints": ["https"],
            "priority": len(_WEB_RULE) + 1,
            "service": name,
            "tls": {"certResolver": "letsencrypt"},
            "middlewares": ["warpdrive-app-headers@docker", "warpdrive-app-body@docker"],
        }
        load_balancer = {
            "servers": [{"url": _upstream(alias)}],
            "passHostHeader": True,
            "healthCheck": {
                "path": "/api/health", "interval": "15s", "timeout": "5s", "hostname": _HOST,
                "headers": {"X-Forwarded-Proto": "https"}, "status": 200, "followRedirects": False,
            },
        }
        if unsafe:
            load_balancer["serversTransport"] = name
        services[name] = {"loadBalancer": load_balancer}
    return {"http": {
        "routers": routers,
        "services": services,
        "serversTransports": {_UNSAFE_ROUTE: {"disableHTTP2": True, "maxIdleConnsPerHost": -1}},
    }}


def compile_traefik_web_handoff(
    installed: bytes, *, expected_sha256: str, original_alias: str, successor_alias: str,
) -> TraefikWebHandoff:
    """Admit the exact old file and change only its two private relay URLs."""
    if not isinstance(installed, bytes) or not 0 < len(installed) <= _MAX_DOCUMENT_BYTES:
        raise ValueError("Bounded installed Traefik JSON bytes required")
    if (not isinstance(expected_sha256, str) or not _SHA256.fullmatch(expected_sha256)
            or sha256(installed).hexdigest() != expected_sha256):
        raise ValueError("Installed Traefik document SHA-256 differs")
    if (not all(isinstance(alias, str) and _ALIAS.fullmatch(alias) for alias in (original_alias, successor_alias))
            or original_alias == successor_alias):
        raise ValueError("Two distinct private Web relay aliases required")

    try:
        document = json.loads(installed.decode("utf-8"), object_pairs_hook=_unique_object)
        # Canonical comparison also rejects JSON type changes such as 200.0.
        canonical = _canonical(document)
    except (ValueError, RecursionError):
        raise ValueError("Invalid installed Traefik JSON document") from None
    if canonical != _canonical(_installed_overlay(original_alias)):
        raise ValueError("Installed Traefik Web relay differs from the reviewed profile")

    for name in _ROUTES:
        document["http"]["services"][name]["loadBalancer"]["servers"][0]["url"] = _upstream(successor_alias)
    after = _canonical(document)
    return TraefikWebHandoff(installed, expected_sha256, after, sha256(after).hexdigest())
