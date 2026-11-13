"""Offline HTTP and CLI controls for the historical custody diagnostic."""

from contextlib import nullcontext, redirect_stderr, redirect_stdout
from email.message import Message
import io
import json
import unittest
from unittest.mock import patch
from urllib.request import HTTPSHandler
from urllib.response import addinfourl

from test_registry_absence import Opener, Response, TOKEN, challenged
import web_custody_diagnostic as diagnostic


SECRET = "fixture-secret-never-in-evidence"
CHALLENGE = f'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="{diagnostic.PULL_SCOPE}"'
CONFIG = {"Docker-Content-Digest": diagnostic.EMPTY_CONFIG_DIGEST, "Content-Length": "2"}


def selected_responses():
    for _, kind, checksum, size in diagnostic.OBJECTS:
        payload = f"sha256:{checksum}"
        raw = diagnostic.custody_manifest(kind, payload, size)
        manifest = diagnostic.manifest_digest(raw)
        yield (raw, manifest, payload, size)


class DiagnosticTests(unittest.TestCase):
    def test_exact_requests_use_read_only_scope_and_fixed_pins_without_publication_authority(self):
        responses = [challenged(CHALLENGE), Response(200, {"token": TOKEN}), Response(200, headers=CONFIG)]
        pins = list(selected_responses())
        for raw, manifest, payload, size in pins:
            headers = {"Content-Type": diagnostic.OCI_MANIFEST, "Docker-Content-Digest": manifest}
            responses.extend((Response(200, raw=raw, headers=headers), Response(200, raw=raw, headers=headers),
                              Response(200, headers={"Docker-Content-Digest": payload, "Content-Length": str(size)})))
        opener = Opener(*responses)
        with patch.object(diagnostic, "_credentials", return_value=SECRET) as credentials:
            report = diagnostic.diagnose(environment={}, opener=opener)
        credentials.assert_called_once()
        self.assertEqual(report["authorization"], "token-obtained")
        self.assertEqual(report["emptyConfig"], "exact-blob-headers")
        self.assertFalse(report["publicationAuthorized"])
        self.assertFalse(report["deploymentAuthorized"])
        self.assertNotIn(SECRET, json.dumps(report))
        self.assertNotIn(TOKEN, json.dumps(report))
        requests = [request for request, _ in opener.calls]
        self.assertEqual(len(requests), 12)
        self.assertEqual(requests[0].full_url, requests[3].full_url)
        self.assertIsNone(requests[0].get_header("Authorization"))
        self.assertEqual(requests[1].full_url, diagnostic.TOKEN_URL)
        self.assertEqual(requests[1].get_header("Authorization"), "Basic " + SECRET)
        self.assertEqual(requests[2].full_url, f"{diagnostic.REGISTRY}/blobs/{diagnostic.EMPTY_CONFIG_DIGEST}")
        self.assertTrue(all(request.data is None for request in requests))
        self.assertTrue(all(request.get_header("Authorization") == "Bearer " + TOKEN for request in requests[2:]))
        self.assertEqual([request.get_method() for request in requests], ["GET", "GET", "HEAD"] + ["GET", "GET", "HEAD"] * 3)
        for n, (obj, (_, manifest, payload, size)) in enumerate(zip(report["objects"], pins, strict=True)):
            tag_url, digest_url, blob_url = (request.full_url for request in requests[3+n*3:6+n*3])
            self.assertEqual(tag_url, f"{diagnostic.REGISTRY}/manifests/{manifest.replace(':', '-')}")
            self.assertEqual(digest_url, f"{diagnostic.REGISTRY}/manifests/{manifest}")
            self.assertEqual(blob_url, f"{diagnostic.REGISTRY}/blobs/{payload}")
            self.assertEqual((obj["tag"], obj["digest"], obj["payload"]),
                             ("exact-manifest", "exact-manifest", "exact-blob-headers"))
            self.assertEqual((obj["manifestDigest"], obj["payloadDigest"], obj["payloadBytes"]), (manifest, payload, size))

    def test_denied_invalid_and_redirected_tokens_do_not_send_a_bearer_or_request_objects(self):
        cases = (
            (Response(403, {"detail": SECRET}), "token-denied"),
            (Response(302, headers={"Location": f"https://wrong.example/{SECRET}"}), "token-redirect-unverified"),
            (Response(200, {"token": TOKEN, "access_token": SECRET}), "token-invalid"),
            (Response(200, raw=b"x" * (diagnostic.MAX_BYTES + 1)), "token-response-too-large"),
        )
        for response, state in cases:
            with self.subTest(state=state), patch.object(diagnostic, "_credentials", return_value=SECRET):
                opener = Opener(challenged(CHALLENGE), response)
                report = diagnostic.diagnose(environment={}, opener=opener)
                self.assertEqual(report["authorization"], state)
                self.assertEqual(report["emptyConfig"], "not-probed")
                self.assertTrue(all(obj["tag"] == obj["digest"] == obj["payload"] == "not-probed" for obj in report["objects"]))
                self.assertEqual(len(opener.calls), 2)
                self.assertNotIn(SECRET, json.dumps(report))

    def test_challenge_must_be_exact_and_credentials_are_only_read_after_validation(self):
        for response, state in (
            (Response(404), "challenge-not-found-unclassified"),
            (challenged(CHALLENGE.replace("https://ghcr.io", "https://wrong.example")), "challenge-unexpected"),
            (challenged(CHALLENGE.replace(":pull", ":pull,push")), "challenge-unexpected"),
            (challenged(CHALLENGE.replace("warpdrive-release-custody", "another-package")), "challenge-unexpected"),
        ):
            with self.subTest(state=state), patch.object(diagnostic, "_credentials") as credentials:
                opener = Opener(response)
                self.assertEqual(diagnostic.diagnose(environment={}, opener=opener)["authorization"], state)
                self.assertEqual(len(opener.calls), 1)
                credentials.assert_not_called()

    def test_structured_manifest_absence_tag_mismatch_and_blob_header_results_stay_distinct(self):
        _, expected_digest, payload, size = next(selected_responses())
        for response, expected in (
            (Response(404, {"errors": [{"code": "MANIFEST_UNKNOWN", "detail": SECRET}]}), "manifest-unknown"),
            (Response(404, {"errors": [{"code": "NAME_UNKNOWN"}]}), "name-unknown"),
            (Response(404, {"errors": [{"code": "MANIFEST_UNKNOWN"}, {"code": "DENIED"}]}), "not-found-unclassified"),
            (Response(403, {"errors": [{"code": "MANIFEST_UNKNOWN"}]}), "denied"),
            (Response(200, raw=b"wrong", headers={"Content-Type": diagnostic.OCI_MANIFEST}), "manifest-mismatch"),
            (Response(200, url=f"https://wrong.example/{SECRET}"), "unexpected-response-url"),
            (Response(503, {"detail": SECRET}), "provider-error"),
            (TimeoutError(SECRET), "transport-error"),
        ):
            with self.subTest(expected=expected):
                self.assertEqual(diagnostic._manifest(Opener(response), expected_digest, b"expected", expected_digest,
                                                      "Bearer " + TOKEN), expected)
        for responses, expected in (
            ((Response(404), Response(404, {"errors": [{"code": "BLOB_UNKNOWN"}]})), "blob-unknown"),
            ((Response(404), Response(404, {"errors": [{"code": "NAME_UNKNOWN"}]})), "name-unknown"),
            ((Response(404), Response(404, raw=b"generic not found")), "not-found-unclassified"),
            ((Response(404), Response(206, raw=b"a")), "blob-observation-changed"),
            ((Response(404), Response(200, raw=b"x" * (diagnostic.MAX_BYTES + 1))), "response-too-large"),
            ((Response(200, headers={"Docker-Content-Digest": payload, "Content-Length": str(size + 1)}),), "blob-header-mismatch"),
            ((Response(307, headers={"Location": f"https://wrong.example/{SECRET}"}),), "redirect-unverified"),
        ):
            with self.subTest(expected=expected):
                opener = Opener(*responses)
                self.assertEqual(diagnostic._blob(opener, payload, size, "Bearer " + TOKEN), expected)
                self.assertEqual(len(opener.calls), len(responses))
                self.assertEqual(opener.calls[0][0].get_method(), "HEAD")
                if len(responses) == 2:
                    fallback = opener.calls[1][0]
                    self.assertEqual(fallback.full_url, opener.calls[0][0].full_url)
                    self.assertEqual(fallback.get_method(), "GET")
                    self.assertEqual(fallback.get_header("Range"), "bytes=0-0")

    def test_real_redirect_handler_declines_cross_host_request_and_keeps_status(self):
        requests = []

        class RedirectFixture(HTTPSHandler):
            def https_open(self, request):
                requests.append(request.full_url)
                headers = Message()
                headers["Location"] = "https://wrong.example/redirect"
                response = addinfourl(io.BytesIO(b"redirect"), headers, request.full_url, 307)
                response.msg = "Temporary Redirect"
                return response

        opener = diagnostic.build_opener(diagnostic.ProxyHandler({}), diagnostic._RejectRedirect(), RedirectFixture())
        self.assertEqual(diagnostic._request(opener, diagnostic.TOKEN_URL, {"Authorization": "Basic " + SECRET})[0], 307)
        self.assertEqual(diagnostic._blob(opener, diagnostic.EMPTY_CONFIG_DIGEST, 2, "Bearer " + TOKEN), "redirect-unverified")
        self.assertEqual(requests, [diagnostic.TOKEN_URL, f"{diagnostic.REGISTRY}/blobs/{diagnostic.EMPTY_CONFIG_DIGEST}"])

    def test_hosted_cli_binds_main_before_and_after_and_suppresses_failure_details(self):
        output, errors = io.StringIO(), io.StringIO()
        env = {"GITHUB_WORKSPACE": "/fixture", "RUNNER_TEMP": "/fixture"}
        with (patch.dict(diagnostic.os.environ, env, clear=True),
              patch.object(diagnostic, "require_hosted", return_value=("a"*40, 10, 2, 1)),
              patch.object(diagnostic, "checkout"), patch.object(diagnostic.Path, "resolve"),
              patch.object(diagnostic, "PublicGitHub"), patch.object(diagnostic, "require_selected_main") as main_check,
              patch.object(diagnostic, "registry_auth", return_value=nullcontext()),
              patch.object(diagnostic, "diagnose", return_value={"deploymentAuthorized": False}),
              redirect_stdout(output), redirect_stderr(errors)):
            self.assertEqual(diagnostic.main(), 0)
            self.assertEqual(main_check.call_count, 2)
            self.assertEqual(json.loads(output.getvalue()), {"deploymentAuthorized": False, "revision": "a"*40,
                                                            "runId": 10, "runAttempt": 2})
            main_check.side_effect = RuntimeError(SECRET)
            self.assertEqual(diagnostic.main(), 1)
            self.assertEqual(errors.getvalue(), "Custody diagnostic unavailable\n")


if __name__ == "__main__":
    unittest.main()
