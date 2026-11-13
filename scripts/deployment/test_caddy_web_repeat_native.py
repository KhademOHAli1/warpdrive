"""Exercise repeat generation changes through native Caddy root-config CAS."""

from collections import deque
from contextlib import closing
from copy import deepcopy
from http.client import HTTPConnection, HTTPResponse
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import unittest

from caddy_admin import CaddyAdmin, _document
from caddy_web_config import PROBE_REQUEST_HEADER, PROBE_RESPONSE_HEADER, _generation_handler
from test_caddy_admin import CADDY, local_peer
from test_caddy_web_repeat import A, B, C, HOST, RELAY, compile_next, installed_after_first_switch
from test_traefik_web_relay import LoopbackFixture, free_port
from test_web_generation_routes import ACTION, AdminConnection, FixtureApp
from web_rollout import rollout_web
from web_switch import DefiniteRejected, SwitchHeld, SwitchUnknown, _read, content_hash


class AssetFixtureApp(FixtureApp):
    def do_GET(self):
        if not self.path.startswith("/_next/static/fixture.css?"):
            super().do_GET()
            return
        self.server.requests.append((self.command, self.path, dict(self.headers), b""))
        payload = f"/* {self.server.deployment_id} */\n".encode()
        self.send_response(200)
        self.send_header("X-Fixture-Deployment", self.server.deployment_id)
        self.send_header("Content-Type", "text/css")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


class ObservedAdmin(CaddyAdmin):
    """Record each attempted native PATCH and inject one uncertain result."""

    fault = None

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.writes = []
        self.truncated_status = None

    def _patch(self, body, etag):
        self.writes.append(content_hash(json.loads(body)))
        if self.fault == "truncated":
            self.fault = None
            # Make a real request on the native admin socket but end the
            # stream before Caddy receives a complete declared request body.
            with closing(AdminConnection(self.path)) as connection:
                connection.connect()
                headers = (f"PATCH /config/ HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n"
                           f"Content-Type: application/json\r\nIf-Match: {etag}\r\n"
                           f"Content-Length: {len(body)}\r\n\r\n").encode("ascii")
                connection.sock.sendall(headers + body[:-1])
                connection.sock.shutdown(socket.SHUT_WR)
                with closing(HTTPResponse(connection.sock)) as response:
                    response.begin()
                    self.truncated_status = response.status
                if self.truncated_status != 400:
                    raise AssertionError("Native Caddy did not reject the truncated request body")
            raise SwitchUnknown("Fixture connection ended before the complete PATCH body")
        super()._patch(body, etag)
        if self.fault == "acknowledgement":
            self.fault = None
            raise SwitchUnknown("Fixture discarded the native successful PATCH acknowledgement")

class NativeRepeatTarget:
    """Bind real Caddy observations to synthetic fixture identities."""

    def __init__(self, fixture, operation, before, after, *, unhealthy=False):
        self.fixture = fixture
        self.unhealthy = unhealthy
        self.documents = {generation.deployment_id: fixture.configs[key]
                          for generation, key in (before, after)}
        slots = []
        for generation, key in (before, after):
            runtime = fixture.runtimes[generation]
            slots.append({"runtime": runtime, "route": {
                "generation": generation.deployment_id, "runtimeId": runtime["runtimeId"],
                "fingerprint": content_hash(fixture.configs[key]),
            }})
        self.plan = {"schemaVersion": 1, "kind": "warpdrive-web-rollout", "operationId": operation,
                     "targetKey": "loopback", "backendFingerprint": "e" * 64, "qualificationSha256": "f" * 64,
                     "before": slots[0], "after": slots[1]}

    def verify_qualification(self, plan, *, initialize):
        return plan == self.plan and (not initialize or self.inspect(plan)["route"] == plan["before"]["route"])

    def inspect(self, plan):
        observed, _ = self.fixture.admin.config()
        self.fixture.assertEqual(self.fixture.autosave(), observed)
        fingerprint = content_hash(observed)
        route = next(slot["route"] for slot in (plan["before"], plan["after"])
                     if slot["route"]["fingerprint"] == fingerprint)
        runtimes = {}
        for side in ("before", "after"):
            slot = plan[side]
            identity = self.observe_health(slot, proxied=False)
            self.fixture.assertTrue(identity["healthy"])
            self.fixture.assertEqual(identity["runtimeId"], slot["runtime"]["runtimeId"])
            self.fixture.assertEqual(identity["generation"], slot["route"]["generation"])
            runtimes[f"{side}Runtime"] = {**slot["runtime"], "runtimeId": identity["runtimeId"]}
        return {**runtimes, "route": route, "backendFingerprint": plan["backendFingerprint"]}

    def observe_health(self, slot, *, proxied):
        generation = slot["route"]["generation"]
        failed = self.unhealthy and proxied and generation == C.deployment_id
        path = "/candidate-unhealthy" if failed else "/api/runtime/web-identity"
        port = self.fixture.relay_port if proxied else self.fixture.ports[generation]
        status, headers, _ = self.fixture.request_from(port, "GET", path)
        self.fixture.assertIn(status, (200, 503))
        return {"healthy": status == 200, "generation": headers["X-Fixture-Deployment"],
                "runtimeId": headers["X-Fixture-Runtime"]}

    def compare_and_swap_route(self, expected, desired):
        before = self.documents[expected["generation"]]
        after = self.documents[desired["generation"]]
        self.fixture.assertEqual(content_hash(before), expected["fingerprint"])
        self.fixture.assertEqual(content_hash(after), desired["fingerprint"])
        self.fixture.admin.compare_and_swap(before, after)
        self.fixture.assertEqual(self.fixture.autosave(), after)


@unittest.skipUnless(CADDY, "Native Caddy executable required")
class NativeRepeatCaddyTests(LoopbackFixture):
    def setUp(self):
        self.directory = Path(self.enterContext(tempfile.TemporaryDirectory(
            prefix="wd-repeat-", dir=Path(tempfile.gettempdir()).resolve(),
        )))
        self.state = self.directory / "state"
        self.path = self.directory / "a.sock"
        self.relay_port = free_port()
        self.runtimes, self.ports, self.apps = {}, {}, {}
        for generation, digit, name in ((A, "1", "old"), (B, "2", "retained"), (C, "3", "current")):
            server = self.start_backend(name, AssetFixtureApp)
            server.generation, server.deployment_id, server.runtime_id = name, generation.deployment_id, digit * 64
            server.requests = deque()
            self.ports[generation.deployment_id] = server.server_port
            self.apps[generation] = server
            self.runtimes[generation] = {
                "runtimeId": server.runtime_id, "name": generation.target, "running": True, "restartCount": 0,
                "imageId": "sha256:" + digit * 64, "sourceRevision": generation.deployment_id[3:],
                "configSha256": digit * 64, "schemaSha256": "d" * 64,
            }
        # Compile with the real installed peer shape first. Project only the
        # loopback peer, listener, socket and upstream endpoints for this run.
        exact = compile_next(installed_after_first_switch())
        self.configs = {key: self.loopback(value) for key, value in exact.items()}
        path = self.directory / "caddy.json"
        path.write_text(json.dumps(self.configs["before"]))
        log = self.enterContext(tempfile.TemporaryFile())
        process = subprocess.Popen(
            [CADDY, "run", "--config", str(path)], cwd=self.directory, stdin=subprocess.DEVNULL,
            stdout=log, stderr=log, env={
                "PATH": os.defpath, "XDG_CONFIG_HOME": str(self.directory), "XDG_DATA_HOME": str(self.directory),
            },
        )
        self.addCleanup(self.stop_process, process)
        deadline = time.monotonic() + 5
        while not self.path.is_socket() and process.poll() is None and time.monotonic() < deadline:
            time.sleep(0.02)
        if not self.path.is_socket():
            log.seek(0)
            self.fail(f"Owned Caddy socket unavailable: {log.read(2500).decode(errors='replace')}")
        self.socket_inode = self.path.stat().st_ino
        self.enterContext(local_peer(process.pid))
        self.admin = ObservedAdmin(
            self.path, socket_uid=os.geteuid(), socket_gid=os.getegid(), socket_mode=0o600,
            directory_uid=os.geteuid(), peer_pid=process.pid, peer_uid=os.geteuid(), peer_gid=os.getegid(),
        )
        self.assert_active("before")

    def loopback(self, document):
        local = deepcopy(document)
        local["admin"]["listen"] = f"unix/{self.path}|0600"
        server = local["apps"]["http"]["servers"]["web-relay"]
        server["listen"] = [f"127.0.0.1:{self.relay_port}"]
        server["trusted_proxies"]["ranges"] = ["127.0.0.1/32"]
        server["routes"][0]["match"][0]["remote_ip"]["ranges"] = ["127.0.0.1/32"]
        ports = {f"{generation.target}:3000": self.ports[generation.deployment_id] for generation in (A, B, C)}
        for route in _generation_handler(local)["routes"]:
            for handler in route["handle"]:
                for upstream in handler.get("upstreams", ()):
                    upstream["dial"] = f"127.0.0.1:{ports[upstream['dial']]}"
        return local

    def autosave(self):
        with (self.directory / "caddy" / "autosave.json").open("rb") as stream:
            raw = stream.read(1024 * 1024 + 1)
        self.assertLessEqual(len(raw), 1024 * 1024)
        return json.loads(raw)

    def assert_active(self, key):
        current, etag = self.admin.config()
        self.assertEqual(current, self.configs[key])
        self.assertEqual(self.autosave(), current)
        self.assertEqual(self.path.stat().st_ino, self.socket_inode)
        return etag

    def request_from(self, port, method, path, *, headers=None, body=None):
        with closing(HTTPConnection("127.0.0.1", port, timeout=3)) as connection:
            connection.request(method, path, body=body, headers={
                "Host": HOST, "X-Forwarded-Proto": "https", "Connection": "close", **(headers or {}),
            })
            response = connection.getresponse()
            raw = response.read(8193)
            self.assertLessEqual(len(raw), 8192)
            return response.status, response.headers, raw

    def route(self, method, path, **kwargs):
        return self.request_from(self.relay_port, method, path, **kwargs)

    def assert_generation(self, key, active, previous, retired):
        self.assert_active(key)
        status, headers, _ = self.route("GET", "/api/runtime/web-identity", headers={PROBE_REQUEST_HEADER: RELAY})
        self.assertEqual((status, headers.get(PROBE_RESPONSE_HEADER), headers["X-Fixture-Deployment"]),
                         (200, RELAY, active.deployment_id))
        status, headers, _ = self.route("GET", "/api/runtime/web-identity")
        self.assertEqual((status, headers.get(PROBE_RESPONSE_HEADER), headers["X-Fixture-Deployment"]),
                         (200, None, active.deployment_id))
        for generation in (active, previous):
            status, headers, asset = self.route("GET", f"/_next/static/fixture.css?dpl={generation.deployment_id}")
            self.assertEqual((status, headers["X-Fixture-Deployment"], asset),
                             (200, generation.deployment_id, f"/* {generation.deployment_id} */\n".encode()))
            body = f"once:{key}:{generation.deployment_id}".encode()
            status, headers, _ = self.route("POST", "/pipeline", body=body, headers={
                "Next-Action": ACTION, "X-Deployment-Id": generation.deployment_id,
            })
            self.assertEqual((status, headers["X-Fixture-Deployment"]), (200, generation.deployment_id))
            deliveries = [target for target, server in self.apps.items() for _, _, _, sent in server.requests if sent == body]
            self.assertEqual(deliveries, [generation])

        before = [len(server.requests) for server in self.apps.values()]
        status, headers, _ = self.route("GET", f"/_next/static/fixture.css?dpl={retired.deployment_id}")
        self.assertEqual((status, headers["X-Warpdrive-Web-Rejection"]), (409, "before-forward"))
        for selector in ({}, {"X-Deployment-Id": retired.deployment_id}):
            status, headers, _ = self.route("POST", "/pipeline", body=b"rejected", headers={
                "Next-Action": ACTION, **selector,
            })
            self.assertEqual((status, headers["X-Warpdrive-Web-Rejection"]), (409, "before-forward"))
        status, headers, _ = self.route("POST", "/board", body=b"", headers={
            "Next-Action": ACTION, "Content-Length": "0", PROBE_REQUEST_HEADER: RELAY,
        })
        self.assertEqual((status, headers["X-Warpdrive-Web-Rejection"], headers[PROBE_RESPONSE_HEADER]),
                         (409, "before-forward", RELAY))
        self.assertEqual([len(server.requests) for server in self.apps.values()], before)

    def forward(self, **options):
        return NativeRepeatTarget(self, "forward", (B, "before"), (C, "after"), **options)

    def execute(self, target, *, initialize=False):
        return rollout_web(target.plan, state_dir=self.state, target=target, initialize=initialize)

    def test_healthy_repeat_rolls_back_to_b_retaining_c_then_reapplies(self):
        self.assert_generation("before", B, A, C)
        old_etag = self.assert_active("before")
        forward = self.forward()
        self.assertEqual(self.execute(forward, initialize=True)["state"], "accepted")
        self.assert_generation("after", C, B, A)
        self.assertNotEqual(self.assert_active("after"), old_etag)
        with self.assertRaises(DefiniteRejected):
            self.admin._patch(_document(self.configs["before"]), old_etag)
        self.assert_active("after")

        rollback = NativeRepeatTarget(self, "healthy-reverse", (C, "after"), (B, "manualRollback"))
        self.assertEqual(self.execute(rollback)["state"], "accepted")
        self.assert_generation("manualRollback", B, C, A)
        reapply = NativeRepeatTarget(self, "reapply", (B, "manualRollback"), (C, "after"))
        self.assertEqual(self.execute(reapply)["state"], "accepted")
        self.assert_active("after")
        self.assertEqual(self.execute(reapply)["state"], "accepted")
        self.assertEqual(self.admin.writes, [content_hash(self.configs[key]) for key in (
            "after", "before", "manualRollback", "after",
        )])

    def test_confirmed_failed_c_restores_the_exact_b_plus_a_preimage_once(self):
        target = self.forward(unhealthy=True)
        receipt = self.execute(target, initialize=True)
        self.assertEqual((receipt["state"], receipt["acceptedGeneration"]), ("rolled-back", B.deployment_id))
        self.assert_generation("before", B, A, C)
        self.assertEqual(self.execute(target), receipt)
        self.assertEqual(self.admin.writes, [content_hash(self.configs[key]) for key in ("after", "before")])

    def test_lost_acknowledgement_adopts_a_real_healthy_c_without_replaying_patch(self):
        target = self.forward()
        self.admin.fault = "acknowledgement"
        with self.assertRaises(SwitchUnknown):
            self.execute(target, initialize=True)
        self.assert_generation("after", C, B, A)
        self.assertEqual(_read(self.state / "web-rollouts/forward.json")["state"], "switch-intent")
        self.assertEqual(self.execute(target)["state"], "accepted")
        self.assertEqual(self.admin.writes, [content_hash(self.configs["after"])])

    def test_truncated_patch_leaves_b_plus_a_and_intent_never_replays(self):
        target = self.forward()
        self.admin.fault = "truncated"
        with self.assertRaises(SwitchUnknown) as failure:
            self.execute(target, initialize=True)
        self.assertIsInstance(failure.exception.__cause__, SwitchUnknown)
        self.assertEqual(self.admin.truncated_status, 400)
        self.assert_generation("before", B, A, C)
        self.assertEqual(_read(self.state / "web-rollouts/forward.json")["state"], "switch-intent")
        with self.assertRaisesRegex(SwitchHeld, "unresolved"):
            self.execute(target)
        self.assertEqual(self.admin.writes, [content_hash(self.configs["after"])])


if __name__ == "__main__":
    unittest.main()
