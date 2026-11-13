"""Exercise installed operator observations using native-shaped Docker readback."""

from copy import deepcopy
from email.message import Message
from http.client import BadStatusLine
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from caddy_web_config import _generation_handler
from installed_web_operator import healthy_rollback, observe_direct_failure
from installed_web_runtime import COMMAND, DATABASE, ENTRYPOINT, MOUNT_TARGETS, NETWORKS, build_candidate, verify_candidate
from installed_web_target import InstalledWebTarget
from test_installed_web_target import Admin, compiled_documents
from test_web_rollout import slot
from test_web_switch import FakeClock
from traefik_web_relay import _caddy_config
from web_generation_routes import WebGeneration, compile_web_generation_routes
from web_rollout import rollout_web
from web_switch import SwitchConflict, content_hash


INGRESS, BACKEND = NETWORKS
NETWORK_IDS = {INGRESS: "1" * 64, BACKEND: "2" * 64}
CONTAINER_ID = "2" * 64
ALIAS = "warpdrive-web-" + "b" * 12
ADDRESS = "10.0.8.17"
RUNTIME_SECRET = "/root/warpdrive-deployment/private/synthetic/runtime-database-url"


def candidate_fixture():
    old_image, new_image = "sha256:" + "a" * 64, "sha256:" + "b" * 64
    old_revision, new_revision = "a" * 40, "b" * 40
    mounts = [{"Source": RUNTIME_SECRET if target == DATABASE else "/synthetic/" + target.rsplit("/", 1)[1],
               "Target": target, "Type": "bind", "ReadOnly": True} for target in sorted(MOUNT_TARGETS)]
    live_mounts = [{"Source": item["Source"], "Destination": item["Target"], "Type": "bind", "RW": False,
                    "Propagation": "rprivate"} for item in mounts]
    incumbent = {
        "Id": "1" * 64, "Name": "/pitant-warpdrive-app-1", "Image": old_image,
        "State": {"Status": "running", "Health": {"Status": "healthy"}},
        "Config": {"Image": old_image, "User": "1000:1000", "WorkingDir": "/app", "Cmd": COMMAND,
                   "Entrypoint": ENTRYPOINT, "StopTimeout": 40, "ExposedPorts": {"3000/tcp": {}},
                   "Labels": {"com.docker.compose.project": "pitant-warpdrive", "com.docker.compose.service": "app"},
                   "Env": ["RUNTIME_COMPONENT=web", "NODE_ENV=production", f"APP_COMMIT={old_revision}", "APP_VERSION=",
                           f"NEXT_DEPLOYMENT_ID=wd-{old_revision}", f"DATABASE_URL_FILE={DATABASE}", "HOSTNAME=0.0.0.0",
                           "PORT=3000"],
                   "Healthcheck": {"Test": ["CMD", "bun", "-e",
                       "fetch('http://localhost:3000/api/health',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"],
                       "Interval": 15_000_000_000, "Timeout": 5_000_000_000, "StartPeriod": 20_000_000_000, "Retries": 8}},
        "HostConfig": {"CapDrop": ["ALL"], "CgroupnsMode": "private", "Init": True, "IpcMode": "private",
                       "LogConfig": {"Type": "json-file", "Config": {"max-file": "3", "max-size": "10m"}},
                       "Memory": 1536 * 1024**2, "MemorySwap": 3 * 1024**3, "NanoCpus": 2_000_000_000, "PidsLimit": 256,
                       "SecurityOpt": ["no-new-privileges:true"], "ShmSize": 64 * 1024**2, "Mounts": mounts},
        "NetworkSettings": {"Networks": {name: {"NetworkID": identifier} for name, identifier in NETWORK_IDS.items()}},
        "Mounts": live_mounts,
    }
    document, _ = build_candidate(incumbent, incumbent_id=incumbent["Id"], incumbent_image=old_image,
                                  incumbent_revision=old_revision, candidate_image=new_image, candidate_revision=new_revision,
                                  alias=ALIAS, network_ids=NETWORK_IDS, runtime_secret=RUNTIME_SECRET)
    networks = deepcopy(document["NetworkingConfig"]["EndpointsConfig"])
    for endpoint in networks.values():
        endpoint.update(EndpointID="3" * 64, IPAddress=ADDRESS)
    row = {"Id": CONTAINER_ID, "Name": "/" + ALIAS, "Image": new_image, "ImageManifestDescriptor": {"digest": new_image},
           "Config": {key: value for key, value in document.items() if key not in {"HostConfig", "NetworkingConfig"}},
           "HostConfig": document["HostConfig"], "Mounts": live_mounts, "RestartCount": 0,
           "State": {"Status": "running", "Running": True, "Pid": 512, "StartedAt": "2026-11-13T09:00:00Z",
                     "OOMKilled": False, "Paused": False, "Restarting": False, "Health": {"Status": "healthy"}},
           "NetworkSettings": {"Networks": networks}}
    return document, row


class DockerReadback:
    def __init__(self, row):
        self.row = deepcopy(row)
        self.foreign_alias = "other-slot"

    def inspect(self, identifier):
        if identifier == CONTAINER_ID:
            return deepcopy(self.row)
        if identifier == "3" * 64:
            return {"NetworkSettings": {"Networks": {INGRESS: {"Aliases": [self.foreign_alias]}}}}
        raise AssertionError("Operator inspected an unadmitted Docker identity")

    def network(self, identifier):
        if identifier != NETWORK_IDS[INGRESS]:
            raise AssertionError("Operator inspected an unadmitted Docker network")
        endpoint = self.row["NetworkSettings"]["Networks"][INGRESS]
        return {"Id": identifier, "Name": INGRESS, "Driver": "bridge", "Containers": {
            CONTAINER_ID: {"Name": ALIAS, "EndpointID": endpoint["EndpointID"], "IPv4Address": endpoint["IPAddress"] + "/24"},
            "3" * 64: {"Name": "other-slot"},
        }}


def response(status, body, *, media=("application/json",), encoding=None):
    headers = Message()
    for value in media:
        headers.add_header("Content-Type", value)
    if encoding is not None:
        headers.add_header("Content-Encoding", encoding)
    return status, headers, body


class DirectFailureTests(unittest.TestCase):
    def setUp(self):
        self.document, row = candidate_fixture()
        self.docker = DockerReadback(row)

    def inspect_candidate(self, row):
        return verify_candidate(row, self.document, alias=ALIAS, network_ids=NETWORK_IDS, runtime_secret=RUNTIME_SECRET)

    def observe(self):
        return observe_direct_failure(self.docker, runtime_id=CONTAINER_ID, alias=ALIAS,
                                      network=NETWORK_IDS[INGRESS], inspect_candidate=self.inspect_candidate)

    def test_native_stopped_row_keeps_static_pins_and_never_probes_missing_endpoint(self):
        row = self.docker.row
        running = self.inspect_candidate(row)
        row["State"].update(Status="exited", Running=False, Pid=0, FinishedAt="2026-11-13T09:01:00Z", ExitCode=0)
        for endpoint in row["NetworkSettings"]["Networks"].values():
            endpoint.update(EndpointID="", IPAddress="")
        self.assertEqual(self.inspect_candidate(row), {**running, "running": False})
        with patch.object(self.docker, "network", side_effect=AssertionError("stopped B has no live endpoint")), \
                patch("installed_web_operator._request", side_effect=AssertionError("stopped B cannot be probed")):
            self.assertIsNone(self.observe())

    def test_exact_application_success_and_failure_are_distinct(self):
        for status, payload, expected in ((503, b'{"ok":false}', True), (200, b'{"ok":true}', False)):
            with self.subTest(status=status), patch("installed_web_operator._request", return_value=response(status, payload)) as probe:
                self.assertIs(self.observe(), expected)
                probe.assert_called_once_with(ADDRESS, 3000, "GET", "/api/health", timeout=7)

    def test_rate_limit_proxy_and_ambiguous_json_never_confirm_failure(self):
        rejected = (
            response(429, b'{"ok":false}'), response(502, b'{"ok":false}'),
            response(503, b"Service Unavailable", media=("text/plain",)),
            response(503, b'{"error":"Service Unavailable"}'), response(503, b'{"ok":false,"extra":true}'),
            response(503, b'{"ok":0}'), response(200, b'{"ok":1}'), response(503, b'{"ok":false,"ok":false}'),
            response(503, b'{"ok":false}', media=("application/json", "application/json")),
            response(503, b'{"ok":false}', encoding="gzip"),
        )
        for reply in rejected:
            with self.subTest(status=reply[0], body=reply[2]), patch("installed_web_operator._request", return_value=reply):
                self.assertIsNone(self.observe())
        for error in (TimeoutError(), BadStatusLine("invalid")):
            with self.subTest(error=type(error)), patch("installed_web_operator._request", side_effect=error):
                self.assertIsNone(self.observe())

    def test_process_or_endpoint_changes_during_request_are_unknown(self):
        original = deepcopy(self.docker.row)
        changes = (
            lambda: self.docker.row["State"].update(Pid=513),
            lambda: self.docker.row["State"].update(StartedAt="2026-11-13T09:01:00Z"),
            lambda: self.docker.row.update(RestartCount=1),
            lambda: self.docker.row["NetworkSettings"]["Networks"][INGRESS].update(EndpointID="4" * 64),
            lambda: self.docker.row["NetworkSettings"]["Networks"][INGRESS].update(IPAddress="10.0.8.18"),
            lambda: setattr(self.docker, "foreign_alias", ALIAS),
        )
        for change in changes:
            self.docker.row = deepcopy(original)
            self.docker.foreign_alias = "other-slot"

            def request(*_args, **_options):
                change()
                return response(503, b'{"ok":false}')

            with patch("installed_web_operator._request", side_effect=request):
                self.assertIsNone(self.observe())


class FollowupTargetTests(unittest.TestCase):
    def setUp(self):
        self.documents = compiled_documents()
        self.before_doc, self.after_doc = (self.documents[key] for key in ("successorA", "successorB"))
        self.forward = {"schemaVersion": 1, "kind": "warpdrive-web-rollout", "operationId": "deploy-one",
                        "targetKey": "installed", "before": slot("1", "a", "a"), "after": slot("2", "b", "b"),
                        "backendFingerprint": "c" * 64, "qualificationSha256": "e" * 64}
        for side, document in (("before", self.before_doc), ("after", self.after_doc)):
            self.forward[side]["route"]["fingerprint"] = content_hash(document)
        self.old = WebGeneration(self.forward["before"]["route"]["generation"], "app")
        self.new = WebGeneration(self.forward["after"]["route"]["generation"], "candidate-alias")
        self.reverse, self.reapply, self.restored_doc = healthy_rollback(self.forward, self.documents, current=self.old, candidate=self.new)
        self.admin = Admin(self.before_doc)
        self.served = {content_hash(self.before_doc): self.forward["before"], content_hash(self.after_doc): self.forward["after"],
                       content_hash(self.restored_doc): self.reverse["after"]}

    def target(self, plan, documents, generations=None):
        def probe(slot, *, proxied):
            observed = self.served[content_hash(self.admin.live)] if proxied else slot
            return {"healthy": True, "runtimeId": observed["runtime"]["runtimeId"], "generation": observed["route"]["generation"]}

        return InstalledWebTarget(plan, admin=self.admin, documents=documents, generations=generations,
            verify_release=lambda selected, **_options: selected == plan,
            observe_runtimes=lambda: {"beforeRuntime": plan["before"]["runtime"], "afterRuntime": plan["after"]["runtime"],
                                      "backendFingerprint": self.forward["backendFingerprint"]},
            probe_health=probe, read_durable_config=lambda: self.admin.persisted)

    def test_healthy_reverse_retains_both_generations_and_reapply_is_one_cas(self):
        forward_target = self.target(self.forward, self.documents)
        reverse_target = self.target(self.reverse, {"successorA": self.after_doc, "successorB": self.restored_doc},
                                     ((self.new, self.old), (self.old, self.new)))
        reapply_target = self.target(self.reapply, {"successorA": self.restored_doc, "successorB": self.after_doc},
                                     ((self.old, self.new), (self.new, self.old)))
        expected = _caddy_config("crm.pitant.de", "10.0.8.2/32", compile_web_generation_routes(current=self.old, previous=self.new))
        self.assertEqual(_generation_handler(self.restored_doc)["routes"][1:], _generation_handler(expected)["routes"])
        self.assertEqual(_generation_handler(self.restored_doc)["routes"][0], _generation_handler(self.before_doc)["routes"][0])
        self.assertNotEqual(self.reverse["after"]["route"]["fingerprint"], self.forward["before"]["route"]["fingerprint"])
        self.assertEqual(self.reapply["before"], self.reverse["after"])
        self.assertFalse(reapply_target.verify_qualification(self.reverse, initialize=False))

        clock = FakeClock()
        with tempfile.TemporaryDirectory() as directory:
            for plan, adapter, initialize, document in (
                (self.forward, forward_target, True, self.after_doc), (self.reverse, reverse_target, False, self.restored_doc),
                (self.reapply, reapply_target, False, self.after_doc), (self.reapply, reapply_target, False, self.after_doc),
            ):
                result = rollout_web(plan, state_dir=Path(directory) / "state", target=adapter, initialize=initialize,
                                     clock=clock.monotonic, sleep=clock.sleep)
                self.assertEqual(result["state"], "accepted")
                self.assertEqual(result["acceptedGeneration"], plan["after"]["route"]["generation"])
                self.assertEqual(self.admin.live, document)
                self.assertEqual(self.admin.persisted, document)
        self.assertEqual(self.admin.writes, [self.after_doc, self.restored_doc, self.after_doc])

    def test_rejects_trusted_generation_bindings_that_do_not_match_docs_or_plan(self):
        documents = {"successorA": self.after_doc, "successorB": self.restored_doc}
        wrong_alias = WebGeneration(self.new.deployment_id, "foreign-web")
        with self.assertRaisesRegex(SwitchConflict, "private admin and non-Web"):
            self.target(self.reverse, documents, ((self.new, self.old), (self.old, wrong_alias)))
        with self.assertRaisesRegex(SwitchConflict, "generation binding differs"):
            self.target(self.reverse, documents, ((self.old, self.new), (self.new, self.old)))
        self.assertEqual(self.admin.writes, [])


if __name__ == "__main__":
    unittest.main()
