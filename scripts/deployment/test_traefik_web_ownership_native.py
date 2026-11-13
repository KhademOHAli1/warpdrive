"""Native edge/relay ownership transition with a loopback Docker API fixture.

Traefik's Docker and file providers process their actual protocols. The fixture
supplies Docker inspect/list/events, loopback endpoint substitutions and a
synthetic WebSocket peer. This does not exercise a Docker daemon or installed
service, ACME issuance, or application WebSocket authentication.
"""

from contextlib import closing
from hashlib import file_digest, sha256
from http.client import HTTPConnection, HTTPException, HTTPResponse
import json
import os
from pathlib import Path
from queue import Queue
import ssl
import subprocess
import time
import unittest
from urllib.parse import urlsplit

from test_traefik_web_ownership import HOST, OLD, incumbent_labels, installed_overlay
from test_traefik_web_relay import CADDY, OPENSSL, FixtureDockerAPI, LoopbackFixture, free_port
from traefik_web_ownership import compile_traefik_web_ownership
from traefik_web_relay import _caddy_config
from web_generation_routes import WebGeneration, compile_web_generation_routes


TRAEFIK = os.environ.get("WARPDRIVE_OWNERSHIP_TRAEFIK")
TRAEFIK_SHA256 = os.environ.get("WARPDRIVE_OWNERSHIP_TRAEFIK_SHA256")
S3 = "s3.crm.pitant.de"
APP_ID, WS_ID, STORAGE_ID = "a" * 64, "b" * 64, "c" * 64
NETWORK = "pitant-warpdrive-ingress"
DEPLOYMENT = "wd-" + "d" * 40
HSTS = "max-age=31536000; includeSubDomains"
FRAME = b"\x81\x81\0\0\0\0x"


class OwnershipDockerAPI(FixtureDockerAPI):
    def do_GET(self):
        if self.path.split("?", 1)[0].endswith("/events"):
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            while (message := self.server.changes.get()) is not None:
                try:
                    self.wfile.write(json.dumps(message).encode() + b"\n")
                    self.wfile.flush()
                except OSError:
                    return
            return
        super().do_GET()


@unittest.skipUnless(TRAEFIK and TRAEFIK_SHA256 and CADDY and OPENSSL,
                     "Explicit checksum-verified Traefik, Caddy and OpenSSL required")
class TraefikWebOwnershipNativeTests(LoopbackFixture):
    def docker_fixture(self, app, ws):
        storage = self.start_backend("storage")
        api = self.start_backend("docker", OwnershipDockerAPI)
        api.changes = Queue()
        self.addCleanup(api.changes.put, None)
        storage_labels = {
            "traefik.enable": "true",
            "traefik.docker.network": NETWORK,
            "traefik.http.routers.warpdrive-storage.entrypoints": "https",
            "traefik.http.routers.warpdrive-storage.rule": f"Host(`{S3}`) && PathPrefix(`/warpdrive`)",
            "traefik.http.routers.warpdrive-storage.service": "warpdrive-storage",
            "traefik.http.routers.warpdrive-storage.middlewares": "fixture-storage-policy",
            "traefik.http.routers.warpdrive-storage.tls": "true",
            "traefik.http.routers.warpdrive-storage.tls.certresolver": "letsencrypt",
            "traefik.http.middlewares.fixture-storage-policy.headers.customresponseheaders.X-Fixture-Storage": "unchanged",
        }
        api.containers = {}
        for identifier, role, labels, server in (
            (APP_ID, "app", app, self.old), (WS_ID, "ws", ws, self.realtime),
            (STORAGE_ID, "storage", storage_labels, storage),
        ):
            labels = {**labels, f"traefik.http.services.warpdrive-{role}.loadbalancer.server.port": str(server.server_port)}
            api.containers[identifier] = {
                "Id": identifier, "Name": f"/{role}", "State": {"Running": True, "Status": "running"},
                "Config": {"Labels": labels}, "HostConfig": {"NetworkMode": NETWORK},
                "NetworkSettings": {"Networks": {NETWORK: {"IPAddress": "127.0.0.1", "NetworkID": "e" * 64}}},
            }
        return api

    def edge_fixture(self, docker_api):
        binary = Path(TRAEFIK)
        self.assertTrue(binary.is_absolute() and binary.is_file())
        self.assertRegex(TRAEFIK_SHA256, r"^[a-f0-9]{64}$")
        with binary.open("rb") as stream:
            self.assertEqual(file_digest(stream, "sha256").hexdigest(), TRAEFIK_SHA256)
        version = subprocess.check_output([binary, "version"], text=True, timeout=5)
        self.assertIn(["Version:", "3.7.17"], [line.split() for line in version.splitlines()])
        self.assertRegex(subprocess.check_output([CADDY, "version"], text=True, timeout=5), r"^v2\.11\.4\s")
        certificate, key = self.directory / "edge.pem", self.directory / "edge.key"
        subprocess.run([OPENSSL, "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                        "-subj", "/CN=127.0.0.1", "-addext", f"subjectAltName=IP:127.0.0.1,DNS:{HOST},DNS:{S3}",
                        "-keyout", str(key), "-out", str(certificate)], capture_output=True, check=True, timeout=8)
        self.tls = ssl.create_default_context(cafile=certificate)
        self.edge_port, self.http_port, self.api_port = (free_port() for _ in range(3))
        self.assertEqual(len({self.edge_port, self.http_port, self.api_port, self.relay_port}), 4)
        watched = self.directory / "watched"
        watched.mkdir(mode=0o700)
        (watched / "tls.yaml").write_text(json.dumps({"tls": {"certificates": [
            {"certFile": str(certificate), "keyFile": str(key)},
        ], "stores": {"default": {"defaultCertificate": {"certFile": str(certificate), "keyFile": str(key)}}}}}))
        self.access = self.directory / "edge-access.jsonl"
        static = self.directory / "edge.yaml"
        static.write_text(json.dumps({
            "global": {"checkNewVersion": False, "sendAnonymousUsage": False},
            "entryPoints": {name: {"address": f"127.0.0.1:{port}"} for name, port in (
                ("https", self.edge_port), ("http", self.http_port), ("traefik", self.api_port),
            )},
            "api": {"insecure": True, "dashboard": False},
            "accessLog": {"filePath": str(self.access), "format": "json", "addInternals": True},
            "providers": {"file": {"directory": str(watched), "watch": True}, "docker": {
                "endpoint": f"tcp://127.0.0.1:{docker_api.server_port}", "watch": True, "exposedByDefault": False,
            }},
            "certificateResolvers": {"letsencrypt": {"acme": {
                "email": "fixture@example.invalid", "storage": str(self.directory / "acme.json"),
                "caServer": f"https://127.0.0.1:{docker_api.server_port}/directory", "tlsChallenge": {},
            }}},
        }))
        (self.directory / "acme.json").touch(mode=0o600)
        self.edge_log = self.start_process([binary, "--configFile=" + str(static)], "Traefik", self.edge_port)
        return watched / "warpdrive-web-relay.yaml"

    def activate(self, watched, document):
        # The only fixture substitution in the compiled file is Web relay
        # endpoint resolution. Middleware, rules and references remain exact.
        adapted = json.loads(document)
        for service in adapted["http"]["services"].values():
            server, = service["loadBalancer"]["servers"]
            self.assertEqual(server["url"], f"http://{OLD}:8080")
            server["url"] = f"http://127.0.0.1:{self.relay_port}"
        staged = self.directory / "relay.staged"
        staged.write_text(json.dumps(adapted))
        staged.replace(watched)

    def http(self, method, path, *, host=HOST, tls=True, headers=None, body=None):
        connection = (self.public_connection() if tls else
                      HTTPConnection("127.0.0.1", self.http_port, timeout=3))
        with closing(connection):
            connection.request(method, path, headers={"Host": host, "Connection": "close", **(headers or {})}, body=body)
            response = connection.getresponse()
            return response.status, response.headers, response.read(8192)

    def edge_data(self):
        with closing(HTTPConnection("127.0.0.1", self.api_port, timeout=2)) as connection:
            connection.request("GET", "/api/rawdata")
            response = connection.getresponse()
            if response.status == 404:
                raise OSError("Owned Traefik API is starting")
            self.assertEqual(response.status, 200)
            return json.loads(response.read(128 * 1024))

    def wait(self, observe, description):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            try:
                if observe():
                    return
            except (OSError, HTTPException):
                pass
            time.sleep(0.05)
        self.edge_log.seek(0)
        self.fail(f"{description}: {self.edge_log.read(3000).decode(errors='replace')}")

    def router(self, path, expected):
        def observed():
            with self.access.open("rb") as stream:
                raw = stream.read(128 * 1024)
            self.assertLess(len(raw), 128 * 1024)
            rows = [json.loads(line) for line in raw.splitlines() if line.endswith(b"}")]
            matches = [row for row in rows if urlsplit(row.get("RequestPath", "")).path == path]
            return bool(matches) and all(row.get("RouterName") == expected for row in matches)
        self.wait(observed, f"Expected router {expected} for {path}")

    def websocket(self, path):
        with closing(self.public_connection()) as connection:
            connection.connect()
            tunnel = connection.sock
            self.assertIsInstance(tunnel, ssl.SSLSocket)
            tunnel.sendall((f"GET {path} HTTP/1.1\r\nHost: {HOST}\r\nOrigin: https://{HOST}\r\n"
                            "Connection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\n"
                            "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n").encode())
            with closing(HTTPResponse(tunnel)) as response:
                response.begin()
                self.assertEqual(response.status, 101)
                self.assertEqual(response.getheader("Sec-WebSocket-Accept"), "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=")
                response_headers = (response.getheader("Strict-Transport-Security"), response.getheader("Server"))
                tunnel.sendall(FRAME)
                self.assertEqual(response.fp.read(3), b"\x81\x01x")
                return response_headers

    def observe_routes(self, phase, *, owned):
        path = f"/ownership-{phase}"
        status, headers, raw = self.http("GET", path)
        self.assertEqual((status, json.loads(raw)["backend"]), (200, "new"))
        self.assertEqual(headers.get("Strict-Transport-Security"), HSTS)
        self.assertIsNone(headers.get("Server"))
        self.assertEqual(json.loads(raw)["headers"]["host"], HOST)
        self.router(path, "warpdrive-web-relay-safe@file")
        status, headers, raw = self.http("HEAD", f"{path}-head")
        self.assertEqual((status, raw), (200, b""))
        self.assertEqual(headers.get("Strict-Transport-Security"), HSTS)
        self.router(f"{path}-head", "warpdrive-web-relay-safe@file")
        status, headers, raw = self.http("POST", f"{path}-post", body=b"accepted once")
        self.assertEqual((status, json.loads(raw)["backend"], json.loads(raw)["body"]), (200, "new", "accepted once"))
        self.assertEqual(headers.get("Strict-Transport-Security"), HSTS)
        self.assertIsNone(headers.get("Server"))
        self.router(f"{path}-post", "warpdrive-web-relay-unsafe@file")
        self.assertEqual([event[2] for event in self.new.events if event[1] == f"{path}-post"], [b"accepted once"])

        for method, expected in (("GET", 301), ("POST", 308)):
            redirect = f"{path}-redirect-{method.lower()}"
            status, headers, _ = self.http(method, f"{redirect}?x=one%20two&y=3", tls=False)
            self.assertEqual(status, expected)
            self.assertEqual(headers.get("Location"), f"https://{HOST}{redirect}?x=one%20two&y=3")
            self.router(redirect, "warpdrive-web-owned-http@file" if owned else "warpdrive-app-http@docker")

        # Traefik rejects the declared size before reading the body. No large
        # request allocation or upload is needed to exercise the actual limit.
        oversized = f"{path}-oversized"
        status, _, _ = self.http("POST", oversized, headers={"Content-Length": "80000001", "Expect": "100-continue"})
        self.assertEqual(status, 413)
        self.router(oversized, "warpdrive-web-relay-unsafe@file")
        self.assertFalse(any(event[1] == oversized for event in self.new.events + self.old.events))

        websocket = f"/_ws/ownership-{phase}"
        ws_router = "warpdrive-web-owned-realtime@file" if owned else "warpdrive-ws@docker"
        status, headers, raw = self.http("GET", websocket)
        self.assertEqual((status, json.loads(raw)["backend"]), (200, "realtime"))
        self.assertEqual(headers.get("Strict-Transport-Security"), HSTS)
        self.assertIsNone(headers.get("Server"))
        self.router(websocket, ws_router)
        upgrade = f"{websocket}-upgrade"
        upgrade_headers = self.websocket(upgrade)
        self.router(upgrade, ws_router)
        storage = f"/warpdrive/ownership-{phase}"
        status, headers, raw = self.http("GET", storage, host=S3)
        self.assertEqual((status, json.loads(raw)["backend"], headers.get("X-Fixture-Storage")), (200, "storage", "unchanged"))
        self.router(storage, "warpdrive-storage@docker")
        return upgrade_headers

    def test_native_providers_keep_file_routes_after_original_app_stops(self):
        app, ws = incumbent_labels()
        before = json.dumps(installed_overlay(OLD)).encode()
        after = compile_traefik_web_ownership(before, expected_current_sha256=sha256(before).hexdigest(),
                                             relay_alias=OLD, host=HOST, app_labels=app, ws_labels=ws)
        caddy = _caddy_config(HOST, "127.0.0.1/32", compile_web_generation_routes(
            current=WebGeneration(DEPLOYMENT, "web-b")))
        self.start_caddy(caddy)
        api = self.docker_fixture(app, ws)
        watched = self.edge_fixture(api)

        def live(middleware, route):
            data = self.edge_data()
            return data.get("middlewares", {}).get(middleware, {}).get("status") == "enabled" and (
                data.get("routers", {}).get(route, {}).get("status") == "enabled")

        self.activate(watched, before)
        self.wait(lambda: live("warpdrive-app-body@docker", "warpdrive-web-relay-safe@file"), "V1 edge policy")
        upgrade_headers = self.observe_routes("before", owned=False)

        self.activate(watched, after)
        self.wait(lambda: live("warpdrive-web-owned-body@file", "warpdrive-web-owned-realtime@file"), "V2 edge policy")
        self.assertEqual(self.observe_routes("active", owned=True), upgrade_headers)
        self.assertIn("warpdrive-app-headers@docker", self.edge_data()["middlewares"])

        # Docker lists stopped containers as well. A die event followed by
        # this exact stopped status removes the app's label-owned policy.
        api.containers[APP_ID] = {**api.containers[APP_ID], "State": {"Running": False, "Status": "exited"}}
        api.changes.put({"Type": "container", "Action": "die", "Actor": {"ID": APP_ID}})
        self.wait(lambda: "warpdrive-app-headers@docker" not in self.edge_data()["middlewares"], "Original app policy withdrawal")
        data = self.edge_data()
        self.assertNotIn("warpdrive-app-http@docker", data["routers"])
        self.assertNotIn("warpdrive-app-body@docker", data["middlewares"])
        self.assertEqual(data["middlewares"]["warpdrive-web-owned-body@file"]["buffering"],
                         {"maxRequestBodyBytes": 80000000, "memRequestBodyBytes": 1048576})
        self.assertEqual(data["routers"]["warpdrive-web-owned-realtime@file"]["service"], "warpdrive-ws@docker")
        self.assertEqual(data["services"]["warpdrive-ws@docker"]["status"], "enabled")
        self.assertEqual(self.observe_routes("retired", owned=True), upgrade_headers)
        self.assertEqual(self.http("GET", "/", host="unrelated.example.invalid")[0], 404)


if __name__ == "__main__":
    unittest.main()
