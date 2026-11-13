"""Fake HTTP/helper tests only: no registry, credential helper or provider is contacted."""
import base64
from email.message import Message
from hashlib import sha256
import io
import json
import os
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

import registry_absence as absence

TAG = "ghcr.io/owner/warpdrive-web:candidate-tested"
SCOPE = "repository:owner/warpdrive-web:pull"
CHALLENGE = f'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="{SCOPE}"'
MISSING = {"errors": [{"code": "MANIFEST_UNKNOWN", "message": "manifest unknown", "detail": {"Tag": "candidate-tested"}}]}
SECRET = "private-fixture-secret-never-in-errors"
TOKEN = "fixture-bearer-token"
CUSTODY_REPOSITORY = "khademohali1/warpdrive-release-custody"
CUSTODY_SCOPE = f"repository:{CUSTODY_REPOSITORY}:pull"
CUSTODY_CHALLENGE = CHALLENGE.replace(SCOPE, CUSTODY_SCOPE)
CUSTODY_MANIFEST = b'{"schemaVersion":2}'


class Response(io.BytesIO):
    def __init__(self, code=404, value=MISSING, headers=None, raw=None, url=None):
        super().__init__(json.dumps(value).encode() if raw is None else raw)
        self.code, self.url = code, url
        self.headers = Message()
        for key, value in (headers or {}).items():
            self.headers[key] = value

    def geturl(self):
        return self.url

    def getcode(self):
        return self.code


class Opener:
    def __init__(self, *responses):
        self.responses = list(responses)
        self.calls = []

    def open(self, request, timeout):
        self.calls.append((request, timeout))
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        if response.url is None:
            response.url = request.full_url
        return response


def challenged(challenge=CHALLENGE):
    return Response(401, {"errors": [{"code": "UNAUTHORIZED"}]}, {"WWW-Authenticate": challenge})


class AbsenceTests(unittest.TestCase):
    def test_only_exact_single_structured_manifest_unknown_404_establishes_absence(self):
        for tag in ("127.0.0.1:49152/owned/fixture:candidate-tested",):
            opener = Opener(Response())
            self.assertIsNone(absence.confirm_absent(tag, environment={}, opener=opener))
            request, timeout = opener.calls[0]
            self.assertEqual(request.get_method(), "GET")
            self.assertEqual(timeout, 10)
            self.assertIsNone(request.get_header("Authorization"))
        for response in (Response(200), Response(403), Response(401), Response(404, raw=b"404 not found"),
                         Response(404, {"errors": [{"code": "NAME_UNKNOWN"}]}),
                         Response(404, {"errors": [{"code": "UNAUTHORIZED"}]}),
                         Response(404, {"errors": [{"code": "MANIFEST_UNKNOWN"}, {"code": "UNAUTHORIZED"}]}),
                         Response(404, {**MISSING, "other": True}),
                         Response(404, raw=b'{"errors":[],"errors":[{"code":"MANIFEST_UNKNOWN"}]}')):
            with self.subTest(response=response), self.assertRaises(absence.AbsenceError):
                absence.confirm_absent("127.0.0.1:49152/fixture:tag", environment={}, opener=Opener(response))

    def test_wrong_host_path_userinfo_digest_query_and_noncanonical_loopback_are_rejected(self):
        for tag in ("example.com/owner/repo:tag", "https://ghcr.io/owner/repo:tag", "user@ghcr.io/owner/repo:tag",
                    "ghcr.io/owner/repo@sha256:" + "a" * 64, "ghcr.io/owner/../repo:tag", "ghcr.io/Owner/repo:tag",
                    "ghcr.io/owner/repo:tag?query=1", "ghcr.io/owner/repo:tag#fragment", "ghcr.io/owner/repo",
                    "localhost:5000/repo:tag", "127.0.0.1:05000/repo:tag", "127.0.0.1:0/repo:tag"):
            opener = Opener()
            with self.subTest(tag=tag), self.assertRaises(absence.AbsenceError):
                absence.confirm_absent(tag, environment={}, opener=opener)
            self.assertEqual(opener.calls, [])

    def test_loopback_auth_challenge_never_reads_or_sends_any_credentials(self):
        calls = []
        with patch.object(absence, "_credentials", side_effect=AssertionError("credentials must not be resolved")):
            with self.assertRaises(absence.AbsenceError):
                absence.confirm_absent("127.0.0.1:49152/fixture:tag", environment={"HOME": "/private"},
                                       runner=lambda *args, **kwargs: calls.append(args), opener=Opener(challenged()))
        self.assertEqual(calls, [])

    def test_initial_unauthenticated_ghcr_404_cannot_hide_private_package_permissions(self):
        opener = Opener(Response())
        with patch.object(absence, "_credentials", side_effect=AssertionError("credentials must not be read without bound challenge")):
            with self.assertRaises(absence.AbsenceError):
                absence.confirm_absent(TAG, environment={"HOME": "/private"}, opener=opener)
        self.assertEqual(len(opener.calls), 1)
        self.assertIsNone(opener.calls[0][0].get_header("Authorization"))

    def test_redirect_transport_oversized_and_malformed_metadata_all_hold(self):
        for response in (Response(302), Response(url="https://other.example/v2/repo/manifests/tag"),
                         Response(raw=b"x" * (absence.MAX_BYTES + 1)), Response(raw=b"{bad"),
                         Response(raw=b'{"errors":[{"code":"MANIFEST_UNKNOWN","detail":NaN}]}'),
                         TimeoutError(SECRET)):
            with self.subTest(response=response), self.assertRaises(absence.AbsenceError) as error:
                absence.confirm_absent(TAG, environment={}, opener=Opener(response))
            self.assertNotIn(SECRET, str(error.exception))
        with self.assertRaises(absence.AbsenceError):
            absence._NoRedirect().redirect_request(None, None, 302, None, None, "https://other.example")

    def test_default_transport_disables_environment_proxies_and_redirects(self):
        opener = Opener(Response())
        with patch.object(absence, "build_opener", return_value=opener) as build:
            absence.confirm_absent("127.0.0.1:49152/fixture:tag", environment={"HTTPS_PROXY": "http://untrusted.example"})
        proxy, redirect = build.call_args.args
        self.assertEqual(proxy.proxies, {})
        self.assertIsInstance(redirect, absence._NoRedirect)


class AuthenticationTests(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.addCleanup(self.scratch.cleanup)
        self.directory = Path(self.scratch.name)
        self.environment = {"DOCKER_CONFIG": str(self.directory), "PATH": "/fixture/bin", "HOME": "/unused-home"}

    def config(self, value):
        (self.directory / "config.json").write_text(json.dumps(value))

    def auth(self):
        # Credential-bearing fixtures remain in memory. Filesystem tests below
        # exercise the real reader with non-sensitive configuration only.
        config = {"auths": {"ghcr.io": {"auth": base64.b64encode(("fixture-user:" + SECRET).encode()).decode()}}}
        reader = patch.object(absence, "_docker_config", return_value=config)
        reader.start()
        self.addCleanup(reader.stop)

    def test_ghcr_bound_challenge_token_and_one_bearer_retry(self):
        self.auth()
        opener = Opener(challenged(), Response(200, {"token": TOKEN}), Response())
        absence.confirm_absent(TAG, environment=self.environment, opener=opener)
        initial, token, retry = [call[0] for call in opener.calls]
        self.assertIsNone(initial.get_header("Authorization"))
        parsed = urlsplit(token.full_url)
        self.assertEqual((parsed.scheme, parsed.netloc, parsed.path), ("https", "ghcr.io", "/token"))
        self.assertEqual(parse_qs(parsed.query), {"service": ["ghcr.io"], "scope": [SCOPE]})
        self.assertEqual(base64.b64decode(token.get_header("Authorization").removeprefix("Basic ")).decode(),
                         "fixture-user:" + SECRET)
        self.assertNotIn(SECRET, token.full_url)
        self.assertEqual(retry.full_url, initial.full_url)
        self.assertEqual(retry.get_header("Authorization"), "Bearer " + TOKEN)
        self.assertEqual(len(opener.calls), 3)
        self.assertEqual(list(self.directory.iterdir()), [])

    def test_pull_push_scope_and_reordered_challenge_fields_stay_repository_bound(self):
        self.auth()
        challenge = 'Bearer scope="repository:owner/warpdrive-web:pull,push", realm="https://ghcr.io/token", service="ghcr.io"'
        opener = Opener(challenged(challenge), Response(200, {"access_token": TOKEN}), Response())
        absence.confirm_absent(TAG, environment=self.environment, opener=opener)
        self.assertEqual(parse_qs(urlsplit(opener.calls[1][0].full_url).query)["scope"], [SCOPE + ",push"])

    def test_challenge_cannot_redirect_credentials_or_expand_scope(self):
        variants = (CHALLENGE.replace("https://ghcr.io/token", "http://ghcr.io/token"),
                    CHALLENGE.replace("https://ghcr.io/token", "https://other.example/token"),
                    CHALLENGE.replace("https://ghcr.io/token", "https://ghcr.io/token?query=1"),
                    CHALLENGE.replace('service="ghcr.io"', 'service="other.example"'),
                    CHALLENGE.replace(SCOPE, "repository:owner/other:pull"),
                    CHALLENGE.replace(SCOPE, "repository:owner/warpdrive-web:push"),
                    CHALLENGE.replace("Bearer", "Basic"), CHALLENGE + ',realm="https://ghcr.io/token"')
        for challenge in variants:
            opener = Opener(challenged(challenge))
            with self.subTest(challenge=challenge), self.assertRaises(absence.AbsenceError):
                absence.confirm_absent(TAG, environment=self.environment, opener=opener)
            self.assertEqual(len(opener.calls), 1)
        response = challenged()
        response.headers["WWW-Authenticate"] = CHALLENGE
        with self.assertRaises(absence.AbsenceError):
            absence.confirm_absent(TAG, environment=self.environment, opener=Opener(response))

    def test_credential_helper_precedence_safe_argv_stdin_and_filtered_environment(self):
        self.config({"credHelpers": {"ghcr.io": "fixture-helper"}, "credsStore": "unused-helper"})
        calls = []
        def runner(arguments, **options):
            calls.append((arguments, options))
            return SimpleNamespace(returncode=0, stdout=json.dumps({"Username": "fixture-user", "Secret": SECRET}), stderr="")
        opener = Opener(challenged(), Response(200, {"token": TOKEN}), Response())
        absence.confirm_absent(TAG, environment={**self.environment, "GH_TOKEN": "unrelated-secret"}, runner=runner, opener=opener)
        arguments, options = calls[0]
        self.assertEqual(arguments, ["docker-credential-fixture-helper", "get"])
        self.assertEqual(options["input"], "ghcr.io")
        self.assertEqual(options["timeout"], 10)
        self.assertTrue(options["capture_output"])
        self.assertFalse(options["check"])
        self.assertNotIn("GH_TOKEN", options["env"])
        self.assertFalse(options.get("shell", False))
        self.assertNotIn(SECRET, repr(arguments))

    def test_global_helper_and_home_default_config_location_are_supported(self):
        directory = self.directory / ".docker"
        directory.mkdir()
        (directory / "config.json").write_text(json.dumps({"credsStore": "fixture-store"}))
        calls = []
        def runner(arguments, **options):
            calls.append(arguments)
            return SimpleNamespace(returncode=0, stdout=json.dumps({"ServerURL": "ghcr.io", "Username": "fixture-user", "Secret": SECRET}), stderr="")
        absence.confirm_absent(TAG, environment={"HOME": str(self.directory)}, runner=runner,
                               opener=Opener(challenged(), Response(200, {"token": TOKEN}), Response()))
        self.assertEqual(calls, [["docker-credential-fixture-store", "get"]])

    def test_unsafe_helper_failure_or_wrong_registry_never_leaks_secret_errors(self):
        for helper, result in (("../helper", None), ("helper;echo", None),
                               ("fixture", SimpleNamespace(returncode=1, stdout=SECRET, stderr=SECRET)),
                               ("fixture", SimpleNamespace(returncode=0, stdout=json.dumps({"ServerURL": "other.example", "Username": "user", "Secret": SECRET}), stderr="")),
                               ("fixture", TimeoutError(SECRET))):
            self.config({"credsStore": helper})
            calls = []
            def runner(arguments, **options):
                calls.append(arguments)
                if isinstance(result, Exception):
                    raise result
                return result
            with self.subTest(helper=helper), self.assertRaises(absence.AbsenceError) as error:
                absence.confirm_absent(TAG, environment=self.environment, runner=runner, opener=Opener(challenged()))
            self.assertNotIn(SECRET, str(error.exception))
            if result is None:
                self.assertEqual(calls, [])

    def test_missing_invalid_or_nonregular_credentials_hold_without_network_retry(self):
        self.config({})
        opener = Opener(challenged())
        with self.assertRaises(absence.AbsenceError):
            absence.confirm_absent(TAG, environment=self.environment, opener=opener)
        self.assertEqual(len(opener.calls), 1)
        with patch.object(absence, "_docker_config", return_value={"auths": {"ghcr.io": {"auth": "invalid!"}}}):
            opener = Opener(challenged())
            with self.assertRaises(absence.AbsenceError):
                absence.confirm_absent(TAG, environment=self.environment, opener=opener)
            self.assertEqual(len(opener.calls), 1)
        (self.directory / "config.json").unlink()
        os.mkfifo(self.directory / "config.json")
        with self.assertRaises(absence.AbsenceError):
            absence.confirm_absent(TAG, environment=self.environment, opener=Opener(challenged()))

    def test_token_and_authenticated_manifest_failures_never_become_absence(self):
        self.auth()
        for responses in ((Response(403),), (Response(200, {"token": "bad\nvalue"}),),
                          (Response(200, {"token": TOKEN, "access_token": "different"}),),
                          (Response(200, {"token": TOKEN}), Response(401)),
                          (Response(200, {"token": TOKEN}), Response(404, {"errors": [{"code": "NAME_UNKNOWN"}]})),
                          (Response(200, {"token": TOKEN}), Response(200))):
            opener = Opener(challenged(), *responses)
            with self.subTest(responses=responses), self.assertRaises(absence.AbsenceError):
                absence.confirm_absent(TAG, environment=self.environment, opener=opener)

    def test_custody_precheck_reads_only_the_fixed_content_tag_with_explicit_scope(self):
        self.auth()
        for write_scope in (False, True):
            with self.subTest(write_scope=write_scope):
                challenge = CUSTODY_CHALLENGE if write_scope else CUSTODY_CHALLENGE.replace(':pull"', ':pull,push"')
                opener = Opener(challenged(challenge), Response(200, {"token": TOKEN}), Response())
                self.assertEqual(absence.precheck_custody_manifest(
                    CUSTODY_MANIFEST, environment=self.environment, use_write_scope=write_scope, opener=opener), "absent")
                initial, token, retry = (request for request, _ in opener.calls)
                expected = f"https://ghcr.io/v2/{CUSTODY_REPOSITORY}/manifests/sha256-{sha256(CUSTODY_MANIFEST).hexdigest()}"
                self.assertEqual((initial.full_url, retry.full_url), (expected, expected))
                self.assertTrue(all(request.get_method() == "GET" and request.data is None
                                    for request in (initial, token, retry)))
                self.assertIsNone(initial.get_header("Authorization"))
                self.assertEqual(retry.get_header("Authorization"), "Bearer " + TOKEN)
                self.assertEqual(parse_qs(urlsplit(token.full_url).query)["scope"],
                                 [CUSTODY_SCOPE + (",push" if write_scope else "")])

    def test_custody_precheck_requires_an_exact_authenticated_manifest_match(self):
        self.auth()
        opener = Opener(challenged(CUSTODY_CHALLENGE), Response(200, {"token": TOKEN}),
                        Response(200, raw=CUSTODY_MANIFEST))
        self.assertEqual(absence.precheck_custody_manifest(
            CUSTODY_MANIFEST, environment=self.environment, opener=opener), "present")
        for responses in ((Response(200, raw=CUSTODY_MANIFEST),), (Response(),), (challenged(),),
                          (challenged(CUSTODY_CHALLENGE), Response(403)),
                          (challenged(CUSTODY_CHALLENGE), Response(200, {"token": TOKEN}), Response(403)),
                          (challenged(CUSTODY_CHALLENGE), Response(200, {"token": TOKEN}),
                           Response(404, {"errors": [{"code": "NAME_UNKNOWN"}]})),
                          (challenged(CUSTODY_CHALLENGE), Response(200, {"token": TOKEN}),
                           Response(200, raw=CUSTODY_MANIFEST + b"\n"))):
            with self.subTest(responses=responses), self.assertRaises(absence.AbsenceError):
                absence.precheck_custody_manifest(CUSTODY_MANIFEST, environment=self.environment,
                                                 use_write_scope=True, opener=Opener(*responses))

    def test_custody_precheck_rejects_invalid_inputs_before_any_request(self):
        for manifest, scope in ((b"", False), (b"x" * 4097, False), ("text", False), (CUSTODY_MANIFEST, 1)):
            opener = Opener()
            with self.subTest(scope=scope), self.assertRaises(absence.AbsenceError):
                absence.precheck_custody_manifest(manifest, environment=self.environment,
                                                 use_write_scope=scope, opener=opener)
            self.assertEqual(opener.calls, [])


class DockerConfigReaderTests(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.addCleanup(self.scratch.cleanup)
        self.directory = Path(self.scratch.name)
        self.environment = {"DOCKER_CONFIG": str(self.directory)}

    def test_real_regular_file_reader_preserves_safe_open_flags_and_nonsecret_json(self):
        value = {"credsStore": "fixture-helper"}
        (self.directory / "config.json").write_text(json.dumps(value))
        actual_open = absence.os.open
        with patch.object(absence.os, "open", wraps=actual_open) as opened:
            self.assertEqual(absence._docker_config(self.environment), value)
        flags = opened.call_args.args[1]
        self.assertEqual(flags & getattr(os, "O_NOFOLLOW", 0), getattr(os, "O_NOFOLLOW", 0))
        self.assertEqual(flags & getattr(os, "O_NONBLOCK", 0), getattr(os, "O_NONBLOCK", 0))

    def test_oversized_malformed_duplicate_or_nonobject_files_are_rejected(self):
        for text in (" " * (absence.MAX_BYTES + 1), "{invalid", "[]",
                     '{"credsStore":"first","credsStore":"second"}'):
            (self.directory / "config.json").write_text(text)
            with self.subTest(length=len(text)), self.assertRaises(absence.AbsenceError):
                absence._docker_config(self.environment)

    def test_reader_refuses_symlink_and_nonregular_fifo_without_following_or_blocking(self):
        target = self.directory / "harmless.json"
        target.write_text("{}")
        path = self.directory / "config.json"
        path.symlink_to(target)
        with self.assertRaises(absence.AbsenceError):
            absence._docker_config(self.environment)
        path.unlink()
        os.mkfifo(path)
        with self.assertRaises(absence.AbsenceError):
            absence._docker_config(self.environment)
        self.assertEqual(target.read_text(), "{}")


if __name__ == "__main__":
    unittest.main()
