import copy
from email.message import Message
import json
from types import SimpleNamespace
import unittest

from web_generation_routes import WebGeneration
from web_mixed_image_smoke import (
    HEADER, LoginAssets, MixedCaddyTarget, browser_message, common_web_configuration,
    generation_configs, observe_asset, observe_identity, read_web_image,
)
from web_switch import DefiniteRejected, content_hash
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
        for row in (old, new):
            row["HostConfig"] = {"ReadonlyRootfs": False}
        new["Config"]["Env"].reverse()
        new["Config"]["Env"][2] = "APP_VERSION=1.6.2"
        original = common_web_configuration(old, BEFORE.deployment_id[3:])
        self.assertEqual(original, common_web_configuration(new, AFTER.deployment_id[3:]))
        new["Config"]["Env"][-1] = "DATABASE_URL=unrelated"
        self.assertNotEqual(original, common_web_configuration(new, AFTER.deployment_id[3:]))
        new["Config"]["Env"].append("DATABASE_URL=fixture")
        with self.assertRaisesRegex(WebSwitchSmokeError, "unique"):
            common_web_configuration(new, AFTER.deployment_id[3:])

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

    def test_requires_exact_secret_free_typed_browser_phases(self):
        active = {"phase": "pre-switch-ready", "oldSocketActive": True}
        self.assertEqual(browser_message(active), active)
        for bad in ({**active, "oldSocketActive": 1}, {**active, "unexpected": "secret"}, {"phase": []}):
            with self.subTest(bad=bad), self.assertRaises(WebSwitchSmokeError):
                browser_message(bad)


if __name__ == "__main__":
    unittest.main()
