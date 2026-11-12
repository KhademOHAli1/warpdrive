"""Compile the Web fallback handler for a two-generation Caddy rollout."""

from dataclasses import dataclass
import re
from typing import Any


_DEPLOYMENT_ID = re.compile(r"wd-[a-f0-9]{40}")
_TARGET = re.compile(r"[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?")

_SAFE = "method('GET', 'HEAD')"
_STATIC = "path('/_next/static/*')"
# Native Route Handlers, including the two ordinary HTML form targets. A Next-Action
# header cannot select a retired generation on these routes.
_DIRECT_POST = (
    "path('/api', '/api/*', '/auth/logout', '/auth/logout/', '/oauth/authorize', "
    "'/oauth/authorize/', '/oauth/token', '/oauth/token/', '/oauth/register', '/oauth/register/')"
)
_ACTION = "header({'Next-Action': '*'})"
_ACTION_ID = "{http.request.header.Next-Action}.matches('^[a-f0-9]{42}$')"
_PAGE_POST = f"method('POST') && !{_DIRECT_POST}"
_MULTIPART = "{http.request.header.Content-Type}.matches('(?i)^[ \\t]*multipart/form-data')"
_HEADER = "header({'X-Deployment-Id': '*'})"
_QUERY = "query({'dpl': '*'})"
# Caddy's parsed query matcher declines malformed queries. Also detect the raw key so
# a malformed or empty dpl value cannot pass as an unversioned mutation.
_DPL = (
    f"({_QUERY} || {{http.request.uri.query}}.matches("
    "'(^|[&;])(?:d|%64)(?:p|%70)(?:l|%6[cC])(?:=|[&;]|$)'))"
)


@dataclass(frozen=True)
class WebGeneration:
    deployment_id: str
    target: str

    def __post_init__(self) -> None:
        if not isinstance(self.deployment_id, str) or not _DEPLOYMENT_ID.fullmatch(self.deployment_id):
            raise ValueError("Invalid Web deployment ID")
        if not isinstance(self.target, str) or not _TARGET.fullmatch(self.target) or self.target == "localhost":
            raise ValueError("Invalid Web target alias")


def _header_is(generation: WebGeneration) -> str:
    # Caddy joins duplicate header/query values with commas. Exact comparison rejects
    # duplicate-identical selectors as well as conflicting or comma-joined selectors.
    return f"{{http.request.header.X-Deployment-Id}} == '{generation.deployment_id}'"


def _dpl_is(generation: WebGeneration) -> str:
    return f"({_QUERY} && {{http.request.uri.query.dpl}} == '{generation.deployment_id}')"


def _selectors_allow(generation: WebGeneration) -> str:
    return f"((!{_HEADER} || {_header_is(generation)}) && (!{_DPL} || {_dpl_is(generation)}))"


def _route(expression: str | None, *handlers: dict[str, Any]) -> dict[str, Any]:
    route = {"handle": list(handlers), "terminal": True}
    if expression is not None:
        route["match"] = [{"expression": expression}]
    return route


def _proxy(generation: WebGeneration, *, safe: bool) -> dict[str, Any]:
    proxy = {
        "handler": "reverse_proxy",
        "upstreams": [{"dial": f"{generation.target}:3000"}],
        "load_balancing": {"retries": 0, "try_duration": 0},
        "headers": {"request": {"set": {"X-Real-Ip": ["{http.request.remote.host}"]}}},
    }
    if not safe:
        # A stale reused Go transport connection can be retried with Idempotency-Key
        # even when Caddy's upstream retries are disabled. Use a fresh connection.
        proxy["transport"] = {"protocol": "http", "keep_alive": {"enabled": False}}
    return proxy


def _reject(expression: str) -> dict[str, Any]:
    return _route(expression, {
        "handler": "static_response",
        "status_code": 409,
        "headers": {
            "Cache-Control": ["no-store"],
            "Content-Type": ["text/plain; charset=utf-8"],
            "X-Warpdrive-Web-Rejection": ["before-forward"],
        },
        "body": "Refresh this page before submitting again.\n",
    })


def compile_web_generation_routes(
    *, current: WebGeneration, previous: WebGeneration,
) -> dict[str, Any]:
    """Replace only the existing Web fallback's reverse_proxy with this handler."""
    if current.deployment_id == previous.deployment_id or current.target == previous.target:
        raise ValueError("Web generations need distinct deployment IDs and target aliases")

    generations = (current, previous)
    routes = [
        _route(f"{_SAFE} && {_STATIC} && {_dpl_is(generation)} && {_selectors_allow(generation)}",
               _proxy(generation, safe=True))
        for generation in generations
    ]
    routes.extend([
        _reject(f"{_SAFE} && {_STATIC} && {_DPL}"),
        _route(_SAFE, _proxy(current, safe=True)),
        _reject("!(" + " || ".join(_selectors_allow(generation) for generation in generations) + ")"),
    ])
    routes.extend(
        _route(f"{_PAGE_POST} && {_ACTION_ID} && ({_header_is(generation)})",
               _proxy(generation, safe=False))
        for generation in generations
    )
    # Pinned Next resolves headerless multipart page actions by decoding their body.
    # Warpdrive has no such form; preserve its URL-bound forms via _DIRECT_POST.
    routes.extend([
        _reject(f"{_PAGE_POST} && ({_ACTION} || {_MULTIPART})"),
        _route(None, _proxy(current, safe=False)),
    ])
    return {"handler": "subroute", "routes": routes}
