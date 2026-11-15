import copy
from email.message import Message
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

from test_web_rollout import Target, slot
from test_web_switch import FakeClock
from web_generation_routes import WebGeneration
from web_mixed_image_smoke import (
    HEADER, LoginAssets, MixedCaddyTarget, MixedWebSmoke, RolloutBrowser, browser_message, common_web_configuration,
    generation_configs, observe_asset, observe_identity, owned_resources_absent, read_web_image,
)
from web_rollout import rollout_web
from web_switch import DefiniteRejected, SwitchHeld, SwitchUnknown, _read, content_hash
from web_switch_smoke import WebSwitchSmokeError


BEFORE = WebGeneration("wd-" + "a" * 40, "web-a")
AFTER = WebGeneration("wd-" + "b" * 40, "web-b")
IMAGE = "sha256:" + "1" * 64


def image(generation=BEFORE):
    return {"Id": IMAGE, "Os": "linux", "Architecture": "amd64", "Config": {
        "User": "bun", "Labels": {"org.opencontainers.image.revision": generation.deployment_id[3:],
                                  "org.opencontainers.image.title": "Warpdrive Web"},
        "Env": ["DATABASE_URL=fixture", "APP_VERSION=1.6.1",
                "APP_COMMIT=" + generation.deployment_id[3:], "NEXT_DEPLOYMENT_ID=" + generation.deployment_id],
    }}


class MixedImageTests(unittest.TestCase):
    def test_requires_exact_local_web_image_and_build_stamp(self):
        metadata = image()
        docker = SimpleNamespace(json=lambda arguments, **kwargs: [metadata])
        self.assertEqual(read_web_image(docker, IMAGE, BEFORE.deployment_id[3:])["generation"], BEFORE.deployment_id)
        for key, bad in (("User", "000:100"), ("Volumes", {"/data": {}}), ("Env", ["APP_COMMIT=stale"])):
            with self.subTest(key=key):
                metadata = image()
                metadata["Config"][key] = bad
                with self.assertRaises(WebSwitchSmokeError):
                    read_web_image(docker, IMAGE, BEFORE.deployment_id[3:])
        metadata = image()
        with self.assertRaises(WebSwitchSmokeError):
            read_web_image(docker, "sha256:" + "2" * 64, BEFORE.deployment_id[3:])

    def test_only_reviewed_build_stamp_and_env_order_are_ignored(self):
        old, new = image(), image(AFTER)
        for row, image_id in ((old, IMAGE), (new, "sha256:" + "2" * 64)):
            row["Image"] = image_id
            row["Config"]["Image"] = image_id
            row["HostConfig"] = {"ReadonlyRootfs": False}
        new["Config"]["Env"].reverse()
        new["Config"]["Env"][2] = "APP_VERSION=1.6.2"
        original = common_web_configuration(old, BEFORE.deployment_id[3:])
        self.assertEqual(original, common_web_configuration(new, AFTER.deployment_id[3:]))
        new["Config"]["Env"][-1] = "DATABASE_URL=unrelated"
        self.assertNotEqual(original, common_web_configuration(new, AFTER.deployment_id[3:]))
        new["Config"]["Image"] = IMAGE
        with self.assertRaisesRegex(WebSwitchSmokeError, "immutable image ID"):
            common_web_configuration(new, AFTER.deployment_id[3:])
        new["Config"]["Image"] = new["Image"]
        new["Config"]["Env"].append("DATABASE_URL=fixture")
        with self.assertRaisesRegex(WebSwitchSmokeError, "unique"):
            common_web_configuration(new, AFTER.deployment_id[3:])

    def test_owned_cleanup_uses_typed_lists_and_exact_names(self):
        responses = {}

        def run(arguments, **_):
            return SimpleNamespace(stdout=responses.get((arguments[0], arguments[-3]), ""))

        docker = SimpleNamespace(run=run)
        resources = [("network", "own-net"), ("container", "own-web"), ("volume", "own-db")]
        responses["network", "name=own-net"] = '"own-net-unrelated"\n'
        self.assertTrue(owned_resources_absent(docker, resources, "own"))
        responses["network", "name=own-net"] += '"own-net"\n'
        self.assertFalse(owned_resources_absent(docker, resources, "own"))

    def test_login_requires_same_origin_stamped_asset_inventory(self):
        generation = BEFORE.deployment_id

        def parse(css, js):
            parser = LoginAssets(generation)
            parser.feed(f'<html data-dpl-id="{generation}"><link href="{css}"><script src="{js}"></script></html>')
            return parser.sample()

        css = f"/_next/static/css/site.css?dpl={generation}"
        js = f"/_next/static/chunks/app/%5Bboard%5D/site.js?dpl={generation}"
        self.assertEqual(parse(css, js), {"css": css, "js": js})
        for wrong in ("https://remote.invalid" + css, css + "&amp;dpl=" + generation,
                      css.replace("site", "%2e%2e/site"), css.replace(generation, AFTER.deployment_id)):
            with self.subTest(wrong=wrong), self.assertRaises(WebSwitchSmokeError):
                parse(wrong, js)

    def test_ingress_identity_and_asset_require_real_generation_header(self):
        headers = Message()
        headers["Cache-Control"] = "no-store"
        headers["Content-Type"] = "text/css"
        headers[HEADER] = BEFORE.deployment_id
        declared = {"contract": "warpdrive.web.identity.v1", "component": "web",
                    "version": "1.6.1", "sourceRevision": BEFORE.deployment_id[3:]}
        client = SimpleNamespace(get=lambda *args: (200, headers, json.dumps(declared).encode()))
        self.assertEqual(observe_identity(client, BEFORE.deployment_id, proxied=True), declared)
        self.assertGreater(observe_asset(client, BEFORE.deployment_id, "css", "unused", proxied=True)["bytes"], 0)
        headers[HEADER] = BEFORE.deployment_id
        with self.assertRaisesRegex(WebSwitchSmokeError, "generation"):
            observe_identity(client, BEFORE.deployment_id, proxied=True)

    def test_compiled_route_changes_only_web_fallback_and_binds_response_generation(self):
        ws = {"handler": "reverse_proxy", "upstreams": [{"dial": "realtime:8080"}]}
        web = {"handler": "reverse_proxy", "upstreams": [{"dial": "web-a:3000"}]}
        base = {"admin": {"enforce_origin": True}, "apps": {"http": {"servers": {"fixture": {"routes": [
            {"handle": [ws]}, {"handle": [web]},
        ]}}}}}
        original = copy.deepcopy(base)
        configs = generation_configs(base, BEFORE, AFTER)
        for active in (BEFORE, AFTER):
            config = configs[active.deployment_id]
            routes = config["apps"]["http"]["servers"]["fixture"]["routes"]
            self.assertEqual(routes[0], {"handle": [ws]})
            self.assertEqual(config["admin"], original["admin"])
            compiled = routes[1]["handle"][0]["routes"]
            last_proxy = compiled[-1]["handle"][0]
            self.assertEqual(last_proxy["upstreams"], [{"dial": active.target + ":3000"}])
            self.assertEqual(last_proxy["headers"]["response"]["set"][HEADER], [active.deployment_id])
        self.assertEqual(base, original)

    def test_refuses_foreign_caddy_readback_and_stale_route(self):
        docs = {item.deployment_id: {"fixture": item.target} for item in (BEFORE, AFTER)}
        slots = {key: {"route": {"generation": key, "fingerprint": content_hash(document)}} for key, document in docs.items()}
        calls = []
        admin = SimpleNamespace(config=lambda: (docs[BEFORE.deployment_id], "old-etag"),
                                request=lambda *args, **kwargs: (calls.append(kwargs) or (412, {}, b"")))
        target = MixedCaddyTarget(SimpleNamespace(admin=admin, browser=None), slots, docs, {})
        before, after = (slots[item.deployment_id]["route"] for item in (BEFORE, AFTER))
        with self.assertRaises(DefiniteRejected):
            target.compare_and_swap_route(after, before)
        self.assertEqual(calls, [])
        with self.assertRaises(DefiniteRejected):
            target.compare_and_swap_route(before, after)
        self.assertEqual(calls, [{"value": docs[AFTER.deployment_id], "etag": "old-etag"}])
        admin.config = lambda: ({"fixture": "foreign"}, "foreign-etag")
        with self.assertRaisesRegex(WebSwitchSmokeError, "differs"):
            target.read_route()

    def test_fault_stops_only_the_candidate_after_acknowledged_caddy_write(self):
        docs = {item.deployment_id: {"fixture": item.target} for item in (BEFORE, AFTER)}
        slots = {item.deployment_id: {"route": {"generation": item.deployment_id,
                 "fingerprint": content_hash(docs[item.deployment_id])}, "runtime": {"name": item.target}}
                 for item in (BEFORE, AFTER)}
        before, after = (slots[item.deployment_id]["route"] for item in (BEFORE, AFTER))
        calls = []
        response = 412

        def patch(*_, **kwargs):
            calls.append(("patch", kwargs))
            return response, {}, b""

        admin = SimpleNamespace(config=lambda: (docs[BEFORE.deployment_id], "old-etag"), request=patch)
        target = MixedCaddyTarget(SimpleNamespace(admin=admin, browser=None,
                                  stop_candidate=lambda name: calls.append(("stop", name))), slots, docs, {})
        target.stop_after_switch = AFTER.deployment_id
        with self.assertRaises(DefiniteRejected):
            target.compare_and_swap_route(before, after)
        self.assertEqual([call[0] for call in calls], ["patch"])
        self.assertEqual(target.stop_after_switch, AFTER.deployment_id)

        response = 200
        target.compare_and_swap_route(before, after)
        self.assertEqual(calls[1:], [("patch", {"value": docs[AFTER.deployment_id], "etag": "old-etag"}),
                                      ("stop", AFTER.target)])
        self.assertIsNone(target.stop_after_switch)

    def test_requires_exact_secret_free_typed_browser_phases(self):
        active = {"phase": "pre-switch-ready", "oldSocketActive": True}
        self.assertEqual(browser_message(active), active)
        for bad in ({**active, "oldSocketActive": 1}, {**active, "unexpected": "secret"}, {"phase": []}):
            with self.subTest(bad=bad), self.assertRaises(WebSwitchSmokeError):
                browser_message(bad)
        self.assertEqual(browser_message({"phase": "pre-switch-armed"}), {"phase": "pre-switch-armed"})
        with self.assertRaises(WebSwitchSmokeError):
            browser_message({"phase": "pre-switch-armed", "oldSocketActive": True})

    def test_browser_failure_reports_only_fixed_stage_names(self):
        browser = RolloutBrowser.__new__(RolloutBrowser)
        browser.errors = ["raw browser diagnostic", '{"event":"browser.web-rollout.failed","stage":"external-url"}',
                          '{"event":"browser.web-rollout.failed","stage":"old-tab-server-action","details":"unsafe"}',
                          '{"event":"browser.web-rollout.failed","stage":"old-tab-server-action"}']
        self.assertEqual(browser.failure_stages(), ["old-tab-server-action"])

    def test_browser_failure_decoder_ignores_arbitrary_json_and_unsafe_diagnostics(self):
        valid = {"event": "browser.web-rollout.failed", "stage": "coordinator-preflight",
                 "reason": "control-eof", "elapsedMs": 60001, "phaseElapsedMs": 12000}
        browser = RolloutBrowser.__new__(RolloutBrowser)
        unsafe = [{}, {"event": "other"}, {"stage": "profile"}, [], None,
                  {**valid, "reason": "https://private.invalid/?ticket=hidden"},
                  {**valid, "stage": "unknown"}, {**valid, "raw": "private"}]
        for key in ("elapsedMs", "phaseElapsedMs"):
            unsafe.extend({**valid, key: value} for value in (True, -1, 1.5, 3600001, None))
        browser.errors = [json.dumps(value) for value in unsafe] + [json.dumps(valid)]
        self.assertEqual(browser.failure_diagnostics(), [valid])
        self.assertEqual(browser.failure_stages(), ["coordinator-preflight"])

    def browser_rollout(self, *, fail_phase=None, lost_patch_ack=False, candidate_ready=True):
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        state = Path(scratch.name) / "target"
        qualification = {"backendFingerprint": "c" * 64}
        plan = {"schemaVersion": 1, "kind": "warpdrive-web-rollout", "operationId": "deploy-one",
                "targetKey": "fixture", "before": slot("1", "a", "a"), "after": slot("2", "b", "b"),
                "backendFingerprint": qualification["backendFingerprint"],
                "qualificationSha256": content_hash(qualification)}
        model = Target(plan)
        model.candidate_ready = candidate_ready
        events = []
        docs = {item["route"]["generation"]: {"fixture": item["runtime"]["name"]}
                for item in (plan["before"], plan["after"])}
        slots = {item["route"]["generation"]: item for item in (plan["before"], plan["after"])}

        def send(command):
            events.append(("send", command))

        def wait(phase, *, timeout):
            events.append(("wait", phase, timeout))
            if phase == fail_phase:
                raise WebSwitchSmokeError("browser control proof unavailable")
            return browser_message({"phase": phase, **({"oldSocketActive": True} if phase == "pre-switch-ready" else {})})

        def patch(method, *, value, etag):
            self.assertEqual((method, etag), ("PATCH", "original-etag"))
            self.assertEqual(_read(state / "web-rollouts/deploy-one.json")["state"], "switch-intent")
            events.append(("patch",))
            model.route = next(slots[generation]["route"] for generation, doc in docs.items() if doc == value)
            if lost_patch_ack:
                raise TimeoutError("lost response")
            return 200, {}, b""

        browser = SimpleNamespace(send=send, wait=wait)
        admin = SimpleNamespace(config=lambda: (docs[model.route["generation"]], "original-etag"), request=patch)
        smoke = SimpleNamespace(admin=admin, browser=browser, fixture=SimpleNamespace(prefix="fixture"))
        target = MixedCaddyTarget(smoke, slots, docs, qualification)
        target.inspect = lambda value: events.append(("inspect",)) or model.inspect(value)
        target.observe_health = lambda item, **options: events.append(("health", item["route"]["generation"],
                                                                       options["proxied"])) or model.observe_health(item, **options)
        clock = FakeClock()
        run = lambda: rollout_web(plan, state_dir=state, target=target,
                                  initialize=not (state / "accepted-web-generation.json").exists(),
                                  clock=clock.monotonic, sleep=clock.sleep)
        return target, events, run, state

    def test_real_controller_finishes_unchanged_health_preflight_before_arming_and_single_patch(self):
        target, events, run, _ = self.browser_rollout()
        self.assertEqual(run()["state"], "accepted")
        armed_at = events.index(("send", "arm-pre-switch"))
        self.assertEqual(len([row for row in events[:armed_at] if row[0] == "health"]), 6)
        self.assertEqual(len([row for row in events[:armed_at] if row[0] == "inspect"]), 14)
        self.assertEqual([row for row in events if row[0] != "inspect" and row[0] != "health"], [
            ("send", "arm-pre-switch"), ("wait", "pre-switch-armed", 8),
            ("send", "pre-switch"), ("wait", "pre-switch-ready", 8), ("patch",), ("send", "switched")])
        self.assertEqual([row["state"] for row in target.browser_control], ["passed", "passed"])
        self.assertTrue(all(row["patchAttempted"] is False and type(row["elapsedMs"]) is int
                            for row in target.browser_control))
        self.assertEqual(run()["state"], "accepted")
        self.assertEqual(len(target.patches), 1)
        self.assertEqual(events.count(("send", "arm-pre-switch")), 1)

    def test_health_rejection_does_not_arm_or_patch(self):
        target, events, run, _ = self.browser_rollout(candidate_ready=False)
        self.assertEqual(run()["state"], "rejected")
        self.assertEqual(target.patches, [])
        self.assertEqual(target.browser_control, [])
        self.assertFalse(any(row[0] in {"send", "patch"} for row in events))

    def test_failed_arm_or_preswitch_proof_holds_without_any_patch_or_retry(self):
        for phase in ("pre-switch-armed", "pre-switch-ready"):
            with self.subTest(phase=phase):
                target, events, run, state = self.browser_rollout(fail_phase=phase)
                with self.assertRaises(SwitchUnknown):
                    run()
                self.assertEqual(target.patches, [])
                self.assertNotIn(("patch",), events)
                self.assertEqual(target.browser_control[-1]["state"], "failed")
                self.assertEqual(_read(state / "web-rollouts/deploy-one.json")["state"], "switch-intent")
                with self.assertRaises(SwitchHeld):
                    run()
                self.assertEqual(events.count(("send", "arm-pre-switch")), 1)

    def test_lost_patch_acknowledgement_stays_unknown_then_observes_without_repeating_control_or_patch(self):
        target, events, run, state = self.browser_rollout(lost_patch_ack=True)
        with self.assertRaises(SwitchUnknown):
            run()
        self.assertEqual(len(target.patches), 1)
        self.assertEqual(_read(state / "web-rollouts/deploy-one.json")["state"], "switch-intent")
        self.assertNotIn(("send", "switched"), events)
        self.assertEqual(run()["state"], "accepted")
        self.assertEqual(events.count(("patch",)), 1)
        self.assertEqual(events.count(("send", "arm-pre-switch")), 1)

    def test_success_report_schema_keeps_diagnostics_empty_and_existing_eight_checks(self):
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        smoke = MixedWebSmoke.__new__(MixedWebSmoke)
        smoke.output_dir = Path(scratch.name) / "output"
        smoke.args = SimpleNamespace(browser=True)
        smoke.report = {"failure": None, "checks": [], "diagnostics": []}
        smoke.browser = SimpleNamespace(failure_stages=lambda: [], failure_diagnostics=lambda: [])
        smoke.target = SimpleNamespace(browser_control=[{"phase": "arm-pre-switch", "state": "passed"}], patches=[{}])
        smoke.generations = ("before", "after")
        for name in ("load", "setup_runtimes", "setup_caddy", "start_browser", "finish_browser"):
            setattr(smoke, name, lambda: {})
        smoke.transition = lambda *_, **__: {}
        smoke.automatic_rollback = lambda *_: {}
        smoke.cleanup = lambda: {"success": True, "errors": []}
        self.assertTrue(smoke.run())
        self.assertEqual(smoke.report["diagnostics"], [])
        self.assertEqual([row["name"] for row in smoke.report["checks"]], [
            "authenticated-baseline-and-local-web", "owned-retained-backend-and-two-web-runtimes",
            "compiled-caddy-and-initial-web", "native-browser-draft-and-authenticated-socket-before-switch",
            "forward-web-generation-switch", "persistent-old-tab-action-and-fresh-realtime-after-switch",
            "rollback-to-retained-web-generation", "stopped-candidate-automatically-restores-retained-web"])


if __name__ == "__main__":
    unittest.main()
