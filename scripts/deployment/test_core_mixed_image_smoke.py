"""Test admission, exact Caddy composition, and bounded mixed Core evidence."""

from copy import deepcopy
import io
import json
from pathlib import Path
import shutil
import subprocess
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from bundle import ARCHIVE, MANIFEST, create_bundle, sha256
from caddy_core_config import core_api_routes
from core_mixed_image_smoke import (
    BROWSER_TRANSITIONS, CORE_BROWSER, CORE_COMMAND, CORE_LOST_REPLY_PROBE, CORE_MEMORY_MIB, CORE_RESPONSE_DROP,
    CORE_RPC_PROBE, FAULT_MEMORY_MIB, CoreBrowser, CoreCaddyTarget, CoreMixedImageSmoke, core_browser_message, main,
)
from image_smoke import SmokeError
from test_bundle import FakeDocker, write_candidate
from test_candidate import SHA, fixture as baseline_inspections
from web_generation_routes import WebGeneration
from web_mixed_image_smoke import MixedWebSmoke, generation_configs
from web_switch import SwitchUnknown, canonical
from web_switch_smoke import GENERATION_HEADER, MIB, WebSwitchSmokeError, fixture_caddyfile


PREFIX = "wd-image-smoke-123456abcdef"
OLD = WebGeneration("wd-" + "a" * 40, PREFIX + "-web-a")
NEW = WebGeneration("wd-" + "b" * 40, PREFIX + "-web-b")
CORE = "sha256:" + "c" * 64
ACTOR = {"id": "12345678-1234-1234-1234-123456789012", "cookie": "wd_sid=fixture-cookie", "csrf": "A" * 43}


class CoreMixedImageTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(TemporaryDirectory())).resolve()
        self.docker = Mock()
        self.args = SimpleNamespace(bundle_dir=self.root / "bundle", output_dir=self.root / "report", baseline_revision=SHA,
                                    new_web_image_id="sha256:" + "b" * 64, new_web_revision="b" * 40,
                                    core_image_id=CORE, core_revision="d" * 40, browser=False, baseline_preloaded=False)
        self.smoke = CoreMixedImageSmoke(self.docker, self.args, self.root)

    def mixed_images(self):
        candidate_dir = self.root / "candidate"
        candidate = write_candidate(candidate_dir, version=2)
        origin = {"kind": "github-actions", "repository": "fixture/warpdrive", "runId": 3, "runAttempt": 1,
                  "event": "workflow_dispatch", "ref": "refs/heads/main"}
        create_bundle(candidate_dir, self.args.bundle_dir, expected_revision=SHA, docker=FakeDocker(), origin=origin)
        self.args.baseline_manifest_sha256 = sha256(self.args.bundle_dir / MANIFEST)
        _, inspected = baseline_inspections()
        self.images = {row["Id"]: row for row in inspected.values()}
        self.baseline_pins = {key: row["imageId"] for key, row in candidate["components"].items()}
        self.images[self.args.new_web_image_id] = deepcopy(inspected["web"])
        self.images[self.args.new_web_image_id]["Id"] = self.args.new_web_image_id
        self.images[self.args.new_web_image_id]["Config"]["Labels"]["org.opencontainers.image.revision"] = self.args.new_web_revision
        for component, revision in ((self.baseline_pins["web"], SHA), (self.args.new_web_image_id, self.args.new_web_revision)):
            config = self.images[component]["Config"]
            config["Labels"]["org.opencontainers.image.title"] = "Warpdrive Web"
            config["Env"] = ["APP_COMMIT=" + revision, "NEXT_DEPLOYMENT_ID=wd-" + revision]
        self.images[CORE] = {"Id": CORE, "Os": "linux", "Architecture": "amd64", "Config": {"User": "bun", "Cmd": CORE_COMMAND,
                             "ExposedPorts": {"3010/tcp": {}}, "Labels": {"org.opencontainers.image.revision": self.args.core_revision}}}
        self.docker.run.return_value.stdout = "linux x86_64"

        def inspect(command, **_options):
            self.assertEqual(command[:2], ["image", "inspect"])
            if command[2] not in self.images:
                raise SmokeError("Docker image failed")
            return [self.images[command[2]]]

        self.docker.json.side_effect = inspect
        self.enterContext(patch("web_mixed_image_smoke.platform.system", return_value="Linux"))
        self.enterContext(patch("web_mixed_image_smoke.platform.machine", return_value="x86_64"))

    def load(self, *, preloaded):
        self.args.baseline_preloaded = preloaded
        self.smoke = CoreMixedImageSmoke(self.docker, self.args, self.root)
        return self.smoke.load()

    def test_preloaded_verifies_real_bundle_and_each_immutable_image_without_loading(self):
        self.mixed_images()
        report = self.load(preloaded=True)
        self.docker.run.assert_called_once_with(["info", "--format", "{{.OSType}} {{.Architecture}}"], timeout=10)
        self.assertEqual({item.args[0][-1] for item in self.docker.json.call_args_list}, set(self.images))
        self.assertEqual(report["coreImage"]["id"], CORE)
        self.assertEqual(report["baselineImageSource"], "preloaded")
        self.assertEqual(report["baselineImages"], self.baseline_pins)
        self.assertEqual(report["bundleManifestSha256"], self.args.baseline_manifest_sha256)
        self.assertEqual(report["archiveSha256"], sha256(self.args.bundle_dir / ARCHIVE))
        self.assertEqual(self.smoke.report["images"], report)

    def test_default_still_loads_exact_archive_once(self):
        self.mixed_images()
        report = self.load(preloaded=False)
        self.assertEqual(report["baselineImageSource"], "archive-load")
        self.assertEqual(self.docker.run.call_count, 2)
        self.docker.run.assert_called_with(["image", "load", "--input", str(self.args.bundle_dir / ARCHIVE)], timeout=300)

    def test_preloaded_refuses_archive_tampering_before_inspecting_images(self):
        self.mixed_images()
        (self.args.bundle_dir / ARCHIVE).write_bytes(b"tampered")
        with self.assertRaisesRegex(ValueError, "bundle content changed"):
            self.load(preloaded=True)
        self.docker.json.assert_not_called()
        self.assertEqual(self.docker.run.call_count, 1)

    def test_preloaded_refuses_missing_wrong_platform_revision_id_and_user(self):
        self.mixed_images()
        worker = self.baseline_pins["worker"]
        exact = self.images[worker]
        for changes, exception in (
            ({"Architecture": "arm64"}, WebSwitchSmokeError),
            ({"Id": self.baseline_pins["realtime"]}, WebSwitchSmokeError),
            ({"Config": exact["Config"] | {"User": "nobody"}}, WebSwitchSmokeError),
            ({"Config": exact["Config"] | {"Labels": {"org.opencontainers.image.revision": "f" * 40}}}, SmokeError),
        ):
            self.images[worker] = exact | changes
            with self.subTest(changes=changes), self.assertRaises(exception):
                self.load(preloaded=True)
        del self.images[worker]
        with self.assertRaisesRegex(SmokeError, "Docker image failed"):
            self.load(preloaded=True)
        self.assertTrue(all(call.args[0][0] == "info" for call in self.docker.run.call_args_list))

    def test_core_identity_and_distinct_pins_hold_before_optional_archive_load(self):
        self.mixed_images()
        exact = self.images[CORE]
        for changes in ({"Architecture": "arm64"}, {"Id": self.baseline_pins["web"]},
                        {"Config": exact["Config"] | {"Volumes": {"/app": {}}}},
                        {"Config": exact["Config"] | {"Cmd": ["bun", "wrong"]}}):
            self.images[CORE] = exact | changes
            with self.subTest(changes=changes), self.assertRaisesRegex(WebSwitchSmokeError, "distinct native final Core"):
                self.load(preloaded=False)
        self.args.core_image_id = self.baseline_pins["worker"]
        with self.assertRaisesRegex(WebSwitchSmokeError, "Distinct immutable Core, Web and retained backend"):
            self.load(preloaded=False)
        self.assertTrue(all(call.args[0][0] == "info" for call in self.docker.run.call_args_list))

    def test_both_native_caddy_configs_keep_same_core_proxy_and_exact_web_policies(self):
        caddy = shutil.which("caddy")
        if caddy is None:
            self.skipTest("Native Caddy binary unavailable")
        self.smoke.fixture = SimpleNamespace(prefix=PREFIX)
        source = fixture_caddyfile(OLD.target, PREFIX + "-realtime").replace(f" header {GENERATION_HEADER} generation-a\n", "")
        result = subprocess.run([caddy, "adapt", "--config", "-", "--adapter", "caddyfile"], input=source,
                                text=True, capture_output=True, timeout=8, check=True)
        adapted = json.loads(result.stdout)
        documents = self.smoke.compile_documents(adapted, OLD, NEW)
        previous = generation_configs(adapted, OLD, NEW)
        for active, retained in ((OLD, NEW), (NEW, OLD)):
            with self.subTest(active=active):
                document = deepcopy(documents[active.deployment_id])
                subprocess.run([caddy, "validate", "--config", "-"], input=canonical(document),
                               capture_output=True, timeout=8, check=True)
                server, = document["apps"]["http"]["servers"].values()
                routes = server["routes"][-1]["handle"][0]["routes"]
                expected = core_api_routes(PREFIX + "-core", active, retained)
                self.assertEqual(routes[:len(expected)], expected)
                del routes[:len(expected)]
                self.assertEqual(document, previous[active.deployment_id])
        self.assertEqual(self.smoke.runtime_memory_limit() - MixedWebSmoke.runtime_memory_limit(self.smoke),
                         (CORE_MEMORY_MIB + FAULT_MEMORY_MIB) * MIB)

    def test_browser_listener_copies_exact_core_and_web_routes_without_disabling_tls(self):
        self.smoke.args.browser = True
        self.smoke.fixture = SimpleNamespace(prefix=PREFIX)
        adapted = {"apps": {"http": {"servers": {"public": {"listen": [":8443"],
            "tls_connection_policies": [{}], "routes": [{"handle": [{"handler": "subroute", "routes": []}]}]}}}}}
        with patch("core_mixed_image_smoke.MixedWebSmoke.compile_documents", return_value={
                OLD.deployment_id: deepcopy(adapted), NEW.deployment_id: deepcopy(adapted)}):
            documents = self.smoke.compile_documents(adapted, OLD, NEW)
        for document in documents.values():
            servers = document["apps"]["http"]["servers"]
            self.assertEqual(servers["public"]["listen"], [":8443"])
            self.assertEqual(servers["public"]["tls_connection_policies"], [{}])
            self.assertEqual(servers["core_fixture_http"], {"listen": [":8080"],
                             "routes": servers["public"]["routes"]})
            self.assertIsNot(servers["public"]["routes"], servers["core_fixture_http"]["routes"])

    def test_core_browser_requires_explicit_core_ticket_and_exact_route_proof(self):
        complete = {"phase": "complete", "freshTicket": True, "resubscribed": True, "persistentDraft": True,
                    "oldAction": True, "actionPosts": 1, "coreTicketsBeforeAndAfter": True, "exactCoreRoute": True,
                    "freshStampedPage": True, "transitions": 5, "rollbackBrowserQualified": True,
                    "primaryDraftUnsubmitted": True}
        self.assertEqual(core_browser_message(complete), complete)
        for changed in (complete | {"exactCoreRoute": False}, complete | {"coreTicketsBeforeAndAfter": False},
                        complete | {"cookie": "must never enter protocol"}, complete | {"actionPosts": True},
                        {"phase": []}):
            with self.subTest(changed=changed), self.assertRaises(WebSwitchSmokeError):
                core_browser_message(changed)

    def browser_after_message(self, phase, revision):
        return {"phase": "after-" + phase, "activeRevision": revision, "freshCoreTicket": True, "resubscribed": True,
                "sameDocument": True, "sameSession": True, "persistentDraft": True, "activePresentation": True,
                "activeAndOldAssets": True, "exactCoreRoute": True, "oldActionPosts": 1}

    def test_every_browser_transition_requires_order_and_exact_active_revision(self):
        smoke = self.smoke
        smoke.args.browser = True
        smoke.browser = Mock()
        smoke.browser_rows = Mock(return_value={"total": 1, "matching": 1, "owned": 1})
        before = {"oldSocketActive": True, "sameDocument": True, "sameSession": True, "persistentDraft": True}
        with self.assertRaisesRegex(WebSwitchSmokeError, "order"):
            smoke.browser_before("reverse")
        smoke.browser.send.assert_not_called()
        for phase in BROWSER_TRANSITIONS:
            active = NEW if phase in {"forward", "reapply"} else OLD
            smoke.browser.wait.side_effect = [core_browser_message({"phase": "before-" + phase, **before}),
                                               core_browser_message(self.browser_after_message(phase, active.deployment_id[3:]))]
            prepared = smoke.browser_before(phase)
            proof = smoke.browser_after(phase, active.deployment_id, prepared)
            self.assertEqual(proof["unsubmittedDraftRows"], 0)
        self.assertEqual(smoke.browser_transitions, list(BROWSER_TRANSITIONS))
        self.assertEqual([call.args[0] for call in smoke.browser.send.call_args_list],
                         [command for phase in BROWSER_TRANSITIONS for command in ("pre-" + phase, phase)])
        with self.assertRaisesRegex(WebSwitchSmokeError, "order"):
            smoke.browser_before("forward")

    def test_stale_browser_generation_or_any_extra_activity_row_holds_progress(self):
        smoke = self.smoke
        smoke.args.browser = True
        smoke.browser = Mock()
        for revision, rows in (("f" * 40, {"total": 1, "matching": 1, "owned": 1}),
                               ("b" * 40, {"total": 2, "matching": 1, "owned": 2}),
                               ("b" * 40, {"total": 2, "matching": 1, "owned": 1}),
                               ("b" * 40, {"total": 1, "matching": 0, "owned": 1})):
            smoke.browser.wait.return_value = self.browser_after_message("forward", revision)
            smoke.browser_rows = Mock(return_value=rows)
            with self.subTest(revision=revision, rows=rows), self.assertRaisesRegex(WebSwitchSmokeError, "leaked Activity"):
                smoke.browser_after("forward", NEW.deployment_id, {})
            self.assertEqual(smoke.browser_transitions, [])

    def test_browser_barrier_wraps_both_explicit_and_automatic_rollback(self):
        smoke = self.smoke
        events = []
        smoke.browser_before = Mock(side_effect=lambda phase: events.append("before:" + phase) or {"prepared": True})
        smoke.browser_after = Mock(side_effect=lambda phase, active, prepared: events.append("after:" + phase) or {"active": active})
        with patch.object(MixedWebSmoke, "transition", side_effect=lambda *_args, **_kwargs: events.append("route") or {}), \
                patch.object(MixedWebSmoke, "automatic_rollback", side_effect=lambda *_args: events.append("two-fault-routes") or {}):
            smoke.transition("reverse", NEW.deployment_id, OLD.deployment_id)
            smoke.automatic_rollback(OLD.deployment_id, NEW.deployment_id)
        self.assertEqual(events, ["before:reverse", "route", "after:reverse",
                                  "before:automatic-rollback", "two-fault-routes", "after:automatic-rollback"])
        self.assertEqual(smoke.browser_after.call_args.args[1], OLD.deployment_id)

    def test_browser_cannot_finish_without_all_rollback_barriers_or_with_leaked_rows(self):
        smoke = self.smoke
        smoke.browser = Mock()
        smoke.browser_transitions = ["forward"]
        with self.assertRaisesRegex(WebSwitchSmokeError, "All browser"):
            smoke.finish_browser()
        smoke.browser.send.assert_not_called()
        smoke.browser_transitions = list(BROWSER_TRANSITIONS)
        smoke.browser_rows = Mock(return_value={"total": 2, "matching": 1, "owned": 1})
        with patch.object(MixedWebSmoke, "finish_browser", return_value={}), self.assertRaisesRegex(WebSwitchSmokeError, "additional"):
            smoke.finish_browser()
        self.assertNotIn("browserRollbackQualified", smoke.report)

    def test_browser_global_row_witness_does_not_hide_another_actor_or_draft(self):
        self.smoke.browser_profile = {"actorId": ACTOR["id"], "activitySubject": "Web rollout " + "a" * 24}
        self.smoke._database = Mock(return_value={"total": 1, "matching": 1, "owned": 1})
        self.assertEqual(self.smoke.browser_rows()["total"], 1)
        query = self.smoke._database.call_args.args[0]
        self.assertIn("'total',count(*)", query)
        self.assertTrue(query.endswith("FROM activities;"))
        self.assertIn("FILTER (WHERE owner_id=", query)

    def test_browser_commands_are_finite_and_json_control_never_contains_credentials(self):
        browser = object.__new__(CoreBrowser)
        browser.process = SimpleNamespace(stdin=io.StringIO())
        for phase in BROWSER_TRANSITIONS:
            browser.send("pre-" + phase)
            browser.send(phase)
        browser.send("finish")
        self.assertEqual(len(browser.process.stdin.getvalue().splitlines()), 11)
        for command in ("switched", "pre-switch", [], "cookie=private"):
            with self.subTest(command=command), self.assertRaises(WebSwitchSmokeError):
                browser.send(command)

    def test_browser_driver_rejects_out_of_order_duplicate_and_extended_commands_without_services(self):
        node = shutil.which("node")
        if node is None:
            self.skipTest("Node unavailable for in-memory browser barrier regression")
        source = (Path(__file__).resolve().parents[2] / CORE_BROWSER).read_text()
        control = source[source.index("function switchControl()") : source.index("async function observeRealSockets(")]
        transitions = source[source.index("const TRANSITIONS = ") + len("const TRANSITIONS = "):]
        transitions = transitions[:transitions.index("];") + 1]
        driver = r"""
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
const input=new EventEmitter();
const requireProof=value=>{if(!value)throw Error('held');};
const make=new Function('createInterface','requireProof',CONTROL+';return switchControl();');
const {state}=make(()=>input,requireProof);
assert.deepEqual(new Function('return '+TRANSITIONS)(),EXPECTED);
state.expected='pre-reverse';input.emit('line',JSON.stringify({command:'pre-forward'}));assert.equal(state.invalid,true);
state.invalid=false;state.received=false;input.emit('line',JSON.stringify({command:'pre-reverse'}));assert.equal(state.received,true);
input.emit('line',JSON.stringify({command:'pre-reverse'}));assert.equal(state.invalid,true);
state.invalid=false;state.received=false;state.expected='reverse';
input.emit('line',JSON.stringify({command:'reverse',cookie:'must not be accepted'}));assert.equal(state.invalid,true);
console.log('in-memory browser barriers passed');
""".replace("CONTROL", json.dumps(control)).replace("TRANSITIONS", json.dumps(transitions)).replace("EXPECTED", json.dumps(BROWSER_TRANSITIONS))
        result = subprocess.run([node, "--input-type=module", "-"], input=driver, text=True, capture_output=True, timeout=8)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "in-memory browser barriers passed")

    def test_browser_resubscription_rechecks_current_live_ack_and_fresh_ticket_without_services(self):
        node = shutil.which("node")
        if node is None:
            self.skipTest("Node unavailable for in-memory live-socket regression")
        source = (Path(__file__).resolve().parents[2] / CORE_BROWSER).read_text()
        start = source.index("async function waitForPrimaryResubscription(")
        helper = source[start:source.index("  let finalWitness;", start)]
        driver = r"""
import assert from 'node:assert/strict';
const closed={id:1,closed:true,open:false,auth:true,user:true,pipeline:true};
const fresh={id:2,closed:false,open:true,auth:true,user:true,pipeline:true};
let remaining=[
{active:1,maxActive:1,violations:0,connections:[closed,fresh],tickets:1},
{active:0,maxActive:1,violations:0,connections:[closed,{...fresh,closed:true,open:false}],tickets:2},
{active:1,maxActive:1,violations:0,connections:[closed,{...fresh,pipeline:false}],tickets:2},
{active:1,maxActive:1,violations:0,connections:[closed,fresh],tickets:2}];
const traffic={coreTickets:0};let drafts=0;
const until=async(predicate,limit)=>{assert.equal(limit,45000);for(let count=0;count<4;count++)if(await predicate())return;throw Error('held');};
const verifyDraft=async()=>{drafts++;};
const socketState=async()=>{const snapshot=remaining.shift();traffic.coreTickets=snapshot.tickets;return snapshot;};
const requireProof=value=>{if(!value)throw Error('held');};
const subscribed=value=>value.open&&value.auth&&value.user&&value.pipeline;
const run=new Function('until','verifyDraft','socketState','requireProof','subscribed','traffic',SOURCE+';return waitForPrimaryResubscription(1,1);');
await run(until,verifyDraft,socketState,requireProof,subscribed,traffic);
assert.equal(drafts,4);assert.equal(remaining.length,0);
remaining=[{active:2,maxActive:2,violations:0,connections:[closed,fresh],tickets:3}];
await assert.rejects(run(until,verifyDraft,socketState,requireProof,subscribed,traffic),/held/u);
console.log('in-memory current socket witness passed');
""".replace("SOURCE", json.dumps(helper))
        result = subprocess.run([node, "--input-type=module", "-"], input=driver, text=True, capture_output=True, timeout=8)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "in-memory current socket witness passed")

    def test_real_route_ack_loss_holds_after_patch_and_recovery_never_replays_it(self):
        before, after = {"generation": "old"}, {"generation": "new"}
        live = {"route": before}
        smoke = SimpleNamespace(browser=None, browser_pre_switch=None)
        def request(method, *, value, etag):
            self.assertEqual((method, etag), ("PATCH", "original-etag"))
            live["route"] = after
            return 200, {}, b""
        smoke.admin = SimpleNamespace(request=Mock(side_effect=request))
        target = CoreCaddyTarget(smoke, {"new": {"route": after}}, {"new": {"config": "new"}}, {})
        target.read_route = Mock(side_effect=lambda: (live["route"], "original-etag"))
        target.lose_next_ack = True
        with self.assertRaises(SwitchUnknown):
            target.compare_and_swap_route(before, after)
        self.assertEqual(target.patches, [{"from": "old", "to": "new"}])
        self.assertEqual(live["route"], after)
        self.assertFalse(target.lose_next_ack)
        smoke.admin.request.assert_called_once()

    def test_lost_mutation_client_keeps_session_on_bounded_stdin(self):
        self.smoke.session = ACTOR
        self.smoke.caddy = PREFIX + "-caddy"
        self.smoke.target = SimpleNamespace(slots={OLD.deployment_id: {"runtime": {"name": PREFIX + "-web-a"}}})
        self.smoke.owned = Mock()
        self.docker.run.return_value.stdout = b'{"status":502,"webGenerationAbsent":true}'
        operation = "Core lost reply 12345678-1234-1234-1234-123456789012"
        self.assertEqual(self.smoke._lost_reply_request(OLD.deployment_id, operation)["status"], 502)
        args = self.docker.run.call_args
        self.assertNotIn(ACTOR["cookie"], " ".join(args.args[0]))
        self.assertEqual(json.loads(args.kwargs["input_bytes"])["session"], ACTOR)
        self.assertEqual(args.kwargs["timeout"], 15)
        self.docker.run.return_value.stdout = b'{"status":200,"webGenerationAbsent":false}'
        with self.assertRaisesRegex(WebSwitchSmokeError, "Web fallback"):
            self.smoke._lost_reply_request(OLD.deployment_id, operation)

    def fault_fixture(self, audit):
        smoke = self.smoke
        smoke.core = PREFIX + "-core"
        smoke.session = ACTOR
        smoke.schema_sha = "original-schema"
        smoke.protected = {"core": {"pid": 7}}
        smoke.protected_runtimes = Mock(return_value=smoke.protected)
        smoke.schema = Mock(side_effect=["original-schema", "fixture-audit-schema", "original-schema"])
        document = {"routes": [{"handler": "reverse_proxy", "upstreams": [{"dial": smoke.core + ":3010"}]} for _ in range(2)]}
        smoke.documents = {OLD.deployment_id: document}
        smoke.target = SimpleNamespace(slots={OLD.deployment_id: {"route": "original-route"}},
                                       read_route=Mock(return_value=("original-route", "etag")))
        smoke.fixture = SimpleNamespace(prefix=PREFIX, start_container=Mock(return_value=PREFIX + "-core-response-drop"),
                                        wait_for=Mock())
        smoke._database = Mock(side_effect=[{"exists": False}, audit, audit, [ACTOR["id"]]])
        smoke._fixture_sql = Mock()
        smoke._patch_fault_route = Mock()
        smoke._lost_reply_request = Mock(return_value={"status": 502, "webGenerationAbsent": True})
        smoke.drain_core = Mock(return_value={"drained": True})
        self.docker.json.return_value = {"attempts": 1, "forwarded": 1, "dropped": 1, "upstreamSuccess": 1, "unexpected": 0}
        return smoke

    def test_lost_reply_requires_one_real_core_write_and_post_drain_mutation_no_fallback(self):
        smoke = self.fault_fixture({"writes": 1, "coreWrites": 1, "owners": [ACTOR["id"]]})
        result = smoke.lost_reply_and_outage(OLD.deployment_id)
        self.assertEqual((result["durableWrites"], result["coreWrites"], result["webFallbackWrites"]), (1, 1, 0))
        self.assertEqual(smoke._lost_reply_request.call_count, 2)
        smoke.drain_core.assert_called_once_with(OLD.deployment_id, expected_schema="fixture-audit-schema")
        self.assertEqual(smoke._patch_fault_route.call_count, 2)
        self.assertIn("application_name", smoke._fixture_sql.call_args_list[0].args[0])
        self.assertIn("GRANT INSERT ON core_mixed_write_audit TO smoke_runtime", smoke._fixture_sql.call_args_list[0].args[0])
        self.assertIn("AFTER INSERT OR UPDATE", smoke._fixture_sql.call_args_list[0].args[0])
        self.assertIn("DROP TRIGGER", smoke._fixture_sql.call_args_list[-1].args[0])
        self.assertEqual(smoke.fixture.start_container.call_args.kwargs["memory"], f"{FAULT_MEMORY_MIB}m")

    def test_duplicate_or_web_write_fails_and_still_removes_the_fixture_audit(self):
        for audit in ({"writes": 2, "coreWrites": 2, "owners": [ACTOR["id"], ACTOR["id"]]},
                      {"writes": 1, "coreWrites": 0, "owners": [ACTOR["id"]]}):
            with self.subTest(audit=audit):
                smoke = self.fault_fixture(audit)
                with self.assertRaisesRegex(WebSwitchSmokeError, "replayed a write or fell back"):
                    smoke.lost_reply_and_outage(OLD.deployment_id)
                smoke.drain_core.assert_not_called()
                self.assertIn("DROP TRIGGER", smoke._fixture_sql.call_args.args[0])

    def test_response_drop_transport_forwards_exact_bytes_once_without_opening_services(self):
        node = shutil.which("node")
        if node is None:
            self.skipTest("Node unavailable for in-memory transport control")
        body = CORE_RESPONSE_DROP.replace("import assert from 'node:assert/strict';", "").replace("import http from 'node:http';", "")
        driver = r"""
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
const servers=[],forwards=[];
const http={createServer(handler){const server=new EventEmitter();server.handler=handler;server.listen=()=>{};server.close=()=>{};servers.push(server);return server;},
request(options,callback){const output=new EventEmitter();output.destroy=()=>{};output.end=body=>{
  forwards.push({options,body});const received=new EventEmitter();received.statusCode=200;callback(received);
  received.emit('data',Buffer.from('{"result":{"data":{"json":{"state":"created"}}}}'));received.emit('end');
};return output;}};
const process={env:{CORE_FAULT_UPSTREAM:'wd-image-smoke-123456abcdef-core',
  CORE_FAULT_OPERATION:'Core lost reply 12345678-1234-1234-1234-123456789012'},once(){}};
new Function('assert','http','process',SOURCE)(assert,http,process);
const bytes=Buffer.from(JSON.stringify({json:{name:process.env.CORE_FAULT_OPERATION,csrfToken:'private-fixture-token'}}));
function request(){const req=new EventEmitter();req.method='POST';req.url='/api/trpc/stats.savedPerformance.create';
req.headers={cookie:'private-fixture-cookie','content-length':String(bytes.length)};req.socket={destroyed:0,destroy(){this.destroyed++;}};
const res={status:null,writeHead(status){this.status=status;return this;},end(){}};
servers[0].handler(req,res);req.emit('data',bytes);req.emit('end');return {req,res};}
const first=request();assert.equal(first.req.socket.destroyed,1);assert.equal(first.res.status,null);
const second=request();assert.equal(second.res.status,503);assert.equal(forwards.length,1);
assert.deepEqual(forwards[0].body,bytes);assert.equal(forwards[0].options.hostname,process.env.CORE_FAULT_UPSTREAM);
assert.equal(forwards[0].options.headers.cookie,'private-fixture-cookie');
let snapshot;servers[1].handler({method:'GET',url:'/snapshot'},{setHeader(){},end(body){snapshot=JSON.parse(body);}});
assert.deepEqual(snapshot,{attempts:2,forwarded:1,dropped:1,upstreamSuccess:1,unexpected:1});
console.log('in-memory transport passed');
""".replace("SOURCE", json.dumps(body))
        result = subprocess.run([node, "--input-type=module", "-"], input=driver, text=True,
                                capture_output=True, timeout=8)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "in-memory transport passed")

    def test_exact_rpc_keeps_cookie_in_stdin_and_refuses_changed_identity_or_schema(self):
        fixture = self.smoke
        fixture.core = PREFIX + "-core"
        fixture.producer = {"id": "producer"}
        fixture.protected = {"core": {"pid": 81}}
        fixture.schema_sha = "e" * 64
        fixture.protected_runtimes = Mock(return_value=fixture.protected)
        fixture._producer = Mock(return_value=fixture.producer)
        fixture.schema = Mock(return_value=fixture.schema_sha)
        route = {"generation": NEW.deployment_id, "fingerprint": "f" * 64}
        fixture.target = SimpleNamespace(slots={NEW.deployment_id: {"route": route}}, read_route=lambda: (route, "etag"))
        fixture.direct_readback = {NEW.deployment_id: {"identity": {"sourceRevision": "b" * 40, "version": "1.2.3"}}}
        result = {"session": ACTOR, "sourceRevision": "b" * 40, "version": "1.2.3", "anonymousDenied": True,
                  "csrfDenied": True, "unknownStampRejected": True, "realtimeTickets": 2, "durableOwnedReports": 2}
        self.docker.run.return_value.stdout = json.dumps(result).encode()
        output = fixture.rpc("baseline", NEW.deployment_id, OLD.deployment_id)
        self.assertNotIn("session", output)
        self.assertEqual(output["durableOwnedReports"], 2)
        fixture.rpc("reapply", NEW.deployment_id, OLD.deployment_id)
        command, = self.docker.run.call_args.args
        self.assertNotIn(ACTOR["cookie"], " ".join(command))
        self.assertIn(ACTOR["cookie"].encode(), self.docker.run.call_args.kwargs["input_bytes"])
        self.docker.run.return_value.stdout = json.dumps(result | {"session": ACTOR | {"csrf": "B" * 43}}).encode()
        with self.assertRaisesRegex(WebSwitchSmokeError, "original native session"):
            fixture.rpc("reapply", NEW.deployment_id, OLD.deployment_id)
        self.docker.run.return_value.stdout = json.dumps(result).encode()
        fixture.schema.return_value = "0" * 64
        with self.assertRaisesRegex(WebSwitchSmokeError, "database schema changed"):
            fixture.rpc("reapply", NEW.deployment_id, OLD.deployment_id)

    def test_probe_script_parses_on_local_bun_without_running_it(self):
        bun = shutil.which("bun")
        if bun is None:
            self.skipTest("Local Bun unavailable")
        transpile = "new Bun.Transpiler({loader:'js'}).transformSync(await Bun.stdin.text())"
        for source in (CORE_RPC_PROBE, CORE_LOST_REPLY_PROBE, CORE_RESPONSE_DROP):
            subprocess.run([bun, "--no-env-file", "-e", transpile], input=source, text=True,
                           capture_output=True, timeout=8, check=True)

    def cli_arguments(self, core_image=CORE):
        return ["--bundle-dir", str(self.root / "bundle"), "--output-dir", str(self.root / "report"),
                "--baseline-manifest-sha256", "f" * 64, "--baseline-revision", "a" * 40,
                "--new-web-revision", "b" * 40, "--core-revision", "d" * 40,
                "--new-web-image-id", "sha256:" + "b" * 64, "--core-image-id", core_image]

    def test_cli_rejects_mutable_or_duplicate_image_reference_before_docker(self):
        with patch("core_mixed_image_smoke.IsolatedDocker") as docker, patch("sys.stderr"):
            for core_image in ("warpdrive:mutable", "sha256:" + "b" * 64):
                with self.subTest(core_image=core_image), self.assertRaises(SystemExit) as error:
                    main(self.cli_arguments(core_image))
                self.assertEqual(error.exception.code, 2)
            docker.assert_not_called()

    def test_cli_passes_explicit_preloaded_mode_to_harness(self):
        with patch("core_mixed_image_smoke.IsolatedDocker"), patch("core_mixed_image_smoke.CoreMixedImageSmoke") as smoke, \
                patch("core_mixed_image_smoke.platform.system", return_value="Linux"), \
                patch("core_mixed_image_smoke.platform.machine", return_value="x86_64"), patch("builtins.print"):
            for preloaded in (False, True):
                options = ["--baseline-preloaded"] if preloaded else []
                self.assertEqual(main(self.cli_arguments() + options), 0)
                self.assertIs(smoke.call_args.args[1].baseline_preloaded, preloaded)

    def test_cli_browser_requires_the_exact_reviewed_gap_pair_before_docker(self):
        with patch("core_mixed_image_smoke.IsolatedDocker") as docker, patch("sys.stderr"):
            for pair in ([], ["--topbar-gaps", "20", "17"], ["--topbar-gaps", "-1", "-3"]):
                with self.subTest(pair=pair), self.assertRaises(SystemExit):
                    main(self.cli_arguments() + ["--browser", *pair])
            docker.assert_not_called()
        with patch("core_mixed_image_smoke.IsolatedDocker"), patch("core_mixed_image_smoke.CoreMixedImageSmoke") as smoke, \
                patch("core_mixed_image_smoke.platform.system", return_value="Linux"), \
                patch("core_mixed_image_smoke.platform.machine", return_value="x86_64"), patch("builtins.print"):
            self.assertEqual(main(self.cli_arguments() + ["--browser", "--topbar-gaps", "20", "18"]), 0)
            self.assertTrue(smoke.call_args.args[1].browser)
            self.assertEqual(smoke.call_args.args[1].topbar_gaps, [20, 18])


if __name__ == "__main__":
    unittest.main()
