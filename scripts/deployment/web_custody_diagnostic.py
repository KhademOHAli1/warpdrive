"""Observe the three historical Web custody objects without changing the registry."""

from http.client import HTTPException
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

from candidate import require
from publication_gate import REPO, require_selected_main
from registry_absence import AbsenceError, CUSTODY_REPOSITORY, MAX_BYTES, OCI_MANIFEST, _credentials, _json, _scope
from web_custody_workflow import OBJECTS, registry_auth, require_hosted
from web_publication_gate import PublicGitHub
from web_release_build import checkout
from web_release_custody import REPOSITORY, custody_manifest, manifest_digest


REGISTRY = f"https://ghcr.io/v2/{CUSTODY_REPOSITORY}"
PULL_SCOPE = f"repository:{CUSTODY_REPOSITORY}:pull"
TOKEN_URL = "https://ghcr.io/token?" + urlencode({"service": "ghcr.io", "scope": PULL_SCOPE})
EMPTY_CONFIG_DIGEST = manifest_digest(b"{}")
REDIRECTS = {301, 302, 303, 307, 308}


class _RejectRedirect(HTTPRedirectHandler):
    def redirect_request(self, *arguments):
        # Keep the original HTTP error for classification; never open Location.
        return None


def _request(transport, url, headers, *, head=False):
    try:
        request = Request(url, headers=headers, method="HEAD" if head else "GET")
        try:
            response = transport.open(request, timeout=10)
        except HTTPError as error:
            response = error
        with response:
            if response.geturl() != url:
                return None, None, b"", "unexpected-response-url"
            status, fields = response.getcode(), response.headers
            raw = b"" if head or status in REDIRECTS else response.read(MAX_BYTES + 1)
            if len(raw) > MAX_BYTES:
                return None, None, b"", "response-too-large"
            return status, fields, raw, None
    except (HTTPException, OSError, ValueError, TypeError, AttributeError):
        return None, None, b"", "transport-error"


def _error_code(raw):
    try:
        value = _json(raw)
    except (AbsenceError, RecursionError):
        return None
    if not isinstance(value, dict) or set(value) != {"errors"}:
        return None
    errors = value["errors"]
    if not isinstance(errors, list) or len(errors) != 1 or not isinstance(errors[0], dict):
        return None
    return errors[0].get("code")


def _http_outcome(status):
    if status in REDIRECTS:
        return "redirect-unverified"
    if status == 401:
        return "unauthorized"
    if status == 403:
        return "denied"
    if status == 404:
        return "not-found-unclassified"
    if status == 429:
        return "rate-limited"
    if 500 <= status <= 599:
        return "provider-error"
    return "unexpected-http-status"


def _authorize(transport, challenge_url, environment, runner):
    status, headers, _, failure = _request(transport, challenge_url, {"Accept": OCI_MANIFEST})
    if failure:
        return "challenge-" + failure, None
    if status != 401:
        return "challenge-" + _http_outcome(status), None
    try:
        challenges = headers.get_all("WWW-Authenticate") or []
        if len(challenges) != 1 or _scope(challenges[0], CUSTODY_REPOSITORY) != PULL_SCOPE:
            return "challenge-unexpected", None
    except (AbsenceError, AttributeError):
        return "challenge-unexpected", None
    try:
        basic = _credentials(environment, runner)
    except AbsenceError:
        return "credentials-unavailable", None
    status, _, raw, failure = _request(transport, TOKEN_URL, {"Accept": "application/json", "Authorization": "Basic " + basic})
    if failure:
        return "token-" + failure, None
    if status != 200:
        return "token-" + _http_outcome(status), None
    try:
        value = _json(raw)
    except (AbsenceError, RecursionError):
        return "token-invalid", None
    if not isinstance(value, dict):
        return "token-invalid", None
    token = value.get("token", value.get("access_token"))
    if (not isinstance(token, str) or not 0 < len(token) <= 16384 or not re.fullmatch(r"[A-Za-z0-9._~+/-]+=*", token)
            or ("token" in value and "access_token" in value and value["token"] != value["access_token"])):
        return "token-invalid", None
    return "token-obtained", "Bearer " + token


def _manifest(transport, reference, expected, digest, authorization):
    status, headers, raw, failure = _request(transport, f"{REGISTRY}/manifests/{reference}",
                                             {"Accept": OCI_MANIFEST, "Authorization": authorization})
    if failure:
        return failure
    if status == 200:
        content_type = headers.get_all("Content-Type") or []
        reported_digest = headers.get_all("Docker-Content-Digest") or []
        if (raw == expected and len(content_type) == 1 and content_type[0].split(";", 1)[0].strip() == OCI_MANIFEST
                and reported_digest in ([], [digest])):
            return "exact-manifest"
        return "manifest-mismatch"
    if status == 404:
        code = _error_code(raw)
        if code == "MANIFEST_UNKNOWN":
            return "manifest-unknown"
        if code == "NAME_UNKNOWN":
            return "name-unknown"
    return _http_outcome(status)


def _blob(transport, digest, size, authorization):
    url = f"{REGISTRY}/blobs/{digest}"
    auth_headers = {"Authorization": authorization}
    status, headers, _, failure = _request(transport, url, auth_headers, head=True)
    if failure:
        return failure
    if status == 200:
        if (headers.get_all("Docker-Content-Digest") == [digest]
                and headers.get_all("Content-Length") == [str(size)]):
            return "exact-blob-headers"
        return "blob-header-mismatch"
    if status == 404:
        # A range read supplies a structured error when HEAD has no body. A
        # concurrent success or ignored Range is classified without streaming a blob.
        status, _, raw, failure = _request(transport, url, {**auth_headers, "Range": "bytes=0-0"})
        if failure:
            return failure
        if status == 404:
            code = _error_code(raw)
            if code == "BLOB_UNKNOWN":
                return "blob-unknown"
            if code == "NAME_UNKNOWN":
                return "name-unknown"
        if status in (200, 206):
            return "blob-observation-changed"
    return _http_outcome(status)


def diagnose(*, environment, runner=subprocess.run, opener=None):
    """Read fixed historical pins and return finite observations with no authorization decision."""
    require(REPOSITORY == f"ghcr.io/{CUSTODY_REPOSITORY}", "Custody diagnostic repository differs")
    transport = opener or build_opener(ProxyHandler({}), _RejectRedirect())
    objects = []
    for filename, kind, checksum, size in OBJECTS:
        digest = f"sha256:{checksum}"
        raw = custody_manifest(kind, digest, size)
        objects.append((filename, digest, size, raw, manifest_digest(raw)))
    first_tag = objects[0][-1].replace(":", "-")
    authorization_state, authorization = _authorize(transport, f"{REGISTRY}/manifests/{first_tag}", environment, runner)
    config = _blob(transport, EMPTY_CONFIG_DIGEST, 2, authorization) if authorization else "not-probed"
    results = []
    for filename, payload_digest, size, raw, digest in objects:
        tag = digest.replace(":", "-")
        results.append({
            "filename": filename, "manifestDigest": digest, "payloadDigest": payload_digest, "payloadBytes": size,
            "tag": _manifest(transport, tag, raw, digest, authorization) if authorization else "not-probed",
            "digest": _manifest(transport, digest, raw, digest, authorization) if authorization else "not-probed",
            "payload": _blob(transport, payload_digest, size, authorization) if authorization else "not-probed",
        })
    return {"schemaVersion": 1, "kind": "warpdrive-web-custody-diagnostic", "repository": REPOSITORY,
            "authorization": authorization_state, "emptyConfig": config, "objects": results,
            "publicationAuthorized": False, "deploymentAuthorized": False}


def main():
    try:
        revision, run_id, attempt, _ = require_hosted(os.environ)
        checkout(Path(os.environ["GITHUB_WORKSPACE"]), revision)
        runner_temp = Path(os.environ["RUNNER_TEMP"]).resolve(strict=True)
        api = PublicGitHub()
        require_selected_main(api, REPO, revision)
        with registry_auth(runner_temp):
            report = diagnose(environment=dict(os.environ))
        require_selected_main(api, REPO, revision)
        print(json.dumps({**report, "revision": revision, "runId": run_id, "runAttempt": attempt}, sort_keys=True))
    except (OSError, RuntimeError, TypeError, ValueError, KeyError, subprocess.SubprocessError):
        print("Custody diagnostic unavailable", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
