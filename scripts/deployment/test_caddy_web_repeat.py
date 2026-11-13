"""Verify repeat Web policy against the first installed Caddy compiler."""

from copy import deepcopy
from hashlib import sha256
import json
import unittest

from caddy_web_config import _generation_handler, compile_successor_web_configs
from caddy_web_repeat import compile_repeat_web_configs
from traefik_web_relay import _caddy_config
from web_generation_routes import WebGeneration, compile_web_generation_routes
from web_switch import canonical


HOST = "crm.pitant.de"
PEER = "10.0.8.3"
RELAY = "warpdrive-web-relay-" + "2" * 12
A = WebGeneration("wd-" + "a" * 40, "app")
B = WebGeneration("wd-" + "b" * 40, "warpdrive-web-" + "b" * 12)
C = WebGeneration("wd-" + "c" * 40, "warpdrive-web-" + "c" * 12)
D = WebGeneration("wd-" + "d" * 40, "warpdrive-web-" + "d" * 12)


def installed_after_first_switch():
    bootstrap = canonical(_caddy_config(HOST, PEER + "/32", compile_web_generation_routes(current=A)))
    return compile_successor_web_configs(
        bootstrap, expected_sha256=sha256(bootstrap).hexdigest(), host=HOST, traefik_ip=PEER,
        installed_relay_alias="warpdrive-web-relay-" + "1" * 12, successor_relay_alias=RELAY,
        current=A, candidate=B,
    )["successorB"]


def compile_next(document, **overrides):
    raw = json.dumps(document, indent=2).encode() + b"\n"
    arguments = {"expected_sha256": sha256(raw).hexdigest(), "host": HOST, "traefik_ip": PEER,
                 "relay_alias": RELAY, "current": B, "previous": A, "candidate": C}
    return compile_repeat_web_configs(raw, **(arguments | overrides))


class RepeatCaddyConfigTests(unittest.TestCase):
    def test_b_plus_a_preimage_and_explicit_b_plus_c_are_distinct(self):
        installed = installed_after_first_switch()
        configs = compile_next(installed)
        before, after, reverse = (configs[key] for key in ("before", "after", "manualRollback"))
        self.assertEqual(before, installed)
        self.assertNotEqual(reverse, before)
        static = None
        for document, active, retained in ((before, B, A), (after, C, B), (reverse, B, C)):
            projected = deepcopy(document)
            marker, *routes = _generation_handler(projected).pop("routes")
            independently_compiled = _caddy_config(HOST, PEER + "/32", compile_web_generation_routes(
                current=active, previous=retained,
            ))
            self.assertEqual(routes, _generation_handler(independently_compiled)["routes"])
            if static is None:
                static = (projected, marker)
            self.assertEqual((projected, marker), static)
        self.assertNotIn(A.deployment_id.encode(), canonical(after))
        self.assertNotIn(A.deployment_id.encode(), canonical(reverse))

    def test_next_compile_accepts_exact_new_forward_or_healthy_reverse_predecessor(self):
        configs = compile_next(installed_after_first_switch())
        for key, current, previous in (("after", C, B), ("manualRollback", B, C)):
            self.assertEqual(compile_next(configs[key], current=current, previous=previous, candidate=D)["before"], configs[key])

    def test_conflicting_bindings_and_unpinned_bytes_fail(self):
        installed = installed_after_first_switch()
        for overrides in ({"current": A}, {"previous": C}, {"candidate": WebGeneration(C.deployment_id, A.target)},
                          {"candidate": WebGeneration(C.deployment_id, RELAY)}, {"relay_alias": "localhost"},
                          {"expected_sha256": "e" * 64}):
            with self.subTest(overrides=overrides), self.assertRaises(ValueError):
                compile_next(installed, **overrides)

    def test_admin_host_transport_marker_and_extra_route_changes_fail_even_with_new_digest(self):
        for edit in ("admin", "host", "peer", "transport", "marker", "extra-route"):
            installed = installed_after_first_switch()
            server = installed["apps"]["http"]["servers"]["web-relay"]
            routes = _generation_handler(installed)["routes"]
            if edit == "admin":
                installed["admin"]["listen"] = "0.0.0.0:2019"
            elif edit == "host":
                server["routes"][0]["match"][0]["host"] = ["wrong.pitant.de"]
            elif edit == "peer":
                server["trusted_proxies"]["ranges"] = ["10.0.8.0/24"]
            elif edit == "transport":
                routes[-1]["handle"][0]["transport"]["keep_alive"]["enabled"] = True
            elif edit == "marker":
                routes[0]["handle"][0]["response"]["deferred"] = False
            else:
                server["routes"].append(deepcopy(server["routes"][-1]))
            with self.subTest(edit=edit), self.assertRaisesRegex(ValueError, "admitted active and previous"):
                compile_next(installed)


if __name__ == "__main__":
    unittest.main()
