"""Run the Core operator actions through the real journal and projection code."""

from functools import partial
import os
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import installed_core_operator as operator
from installed_core_activation import reconcile_initial_core_route, reverse_initial_core_route
from installed_web_chain import _state
import test_installed_core_activation as fixtures
from web_switch import SwitchConflict, SwitchUnknown, canonical, content_hash


class InstalledCoreOperatorTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixture = fixtures.InstalledCoreActivationTests()
        self.addCleanup(fixture.doCleanups)
        fixture.setUp()
        root = fixture.original.parent
        first, previous, operation = (root / name for name in ("first", "previous", "operation"))
        for path in (first, previous, previous / "lineage", operation):
            path.mkdir(mode=0o700)
        first.joinpath("rollout").symlink_to(fixture.state, target_is_directory=True)
        self.profile = {"corePin": {"ingress": {"alias": fixture.alias}}, "coreWitness": {"id": "core"}}
        fixture.live_backend = content_hash({"schemaSha256": "e" * 64, "processes": {"core": self.profile["coreWitness"]}})
        fixture.chain["backendFingerprint"] = fixture.predecessor["backendFingerprint"]
        preimage = operation / "accepted-web-preimage.json"
        profile = operation / "retained-core.json"
        for path, value in ((preimage, fixture.before), (profile, self.profile)):
            path.write_bytes(canonical(value))
            path.chmod(0o600)
        binding = {"daemon": {"serverId": "fixture", "socketDevice": 3, "socketInode": 4},
                   "backend": {"backendFingerprint": fixture.predecessor["backendFingerprint"], "schemaSha256": "e" * 64,
                               "processes": {}},
                   "inputs": {"edgeIP": fixtures.PEER, "successorRelayAlias": fixtures.RELAY, "version": "1.0.0"}}
        core_sha, lineage_sha, before_sha, after_sha = map(content_hash, (self.profile, fixture.chain, fixture.before, fixture.after))
        self.activation_binding = {"schemaVersion": 1, "kind": "warpdrive-installed-core-activation", "targetKey": fixture.chain["targetKey"],
                   "acceptedChainSha256": lineage_sha, "coreAuthoritySha256": core_sha, "oldBackendFingerprint": fixture.chain["backendFingerprint"],
                   "newBackendFingerprint": fixture.live_backend, "oldRouteSha256": before_sha, "newRouteSha256": after_sha}
        self.args = SimpleNamespace(action="activate", original=fixture.original, first=first, previous=previous, operation=operation,
            lineage_sha256=lineage_sha, lineage_index_sha256="b" * 64, first_accepted_operation="web-aaaaaaaaaaaa-reapply",
            first_accepted_plan_sha256="c" * 64, web_preimage_sha256=before_sha, retained_core_sha256=core_sha,
            core_activation_sha256=content_hash(self.activation_binding), projection_sha256=None, acceptance_sha256=None)
        self.enterContext(patch.object(operator, "INSTALLATION_UID", os.geteuid()))
        self.enterContext(patch.object(operator, "_directory_under_installation", side_effect=lambda path: path.resolve(strict=True)))
        self.enterContext(patch.object(operator, "_historical", return_value=(fixture.chain, fixture.predecessor)))
        self.enterContext(patch.object(operator, "_original", return_value=(binding, content_hash(binding))))
        self.enterContext(patch.object(operator, "LocalDocker")).return_value.identity.return_value = binding["daemon"]
        self.enterContext(patch.object(operator, "InstalledDocker"))
        self.install = self.enterContext(patch.object(operator, "InstalledWebSuccessor")).return_value
        self.install._retained.return_value = {"backendFingerprint": fixture.live_backend}, None
        self.install.admin, self.install.network = fixture.admin, "ingress"
        self.enterContext(patch.object(operator, "read_autosave", side_effect=lambda _: fixture.admin.persisted))
        self.enterContext(patch.object(operator, "network_peer", return_value="192.0.2.4"))
        self.direct = self.enterContext(patch.object(operator, "read_direct_web", return_value=True))
        self.enterContext(patch.object(operator, "read_public_web_health", return_value=True))
        self.core = self.enterContext(patch.object(operator, "read_public_core_route",
            side_effect=lambda _, *, active: fixture.admin.live == (fixture.after if active else fixture.before)))
        self.enterContext(patch.object(operator, "reconcile_initial_core_route",
            new=partial(reconcile_initial_core_route, clock=fixture.clock.monotonic, sleep=fixture.clock.sleep)))
        self.enterContext(patch.object(operator, "reverse_initial_core_route",
            new=partial(reverse_initial_core_route, clock=fixture.clock.monotonic, sleep=fixture.clock.sleep)))

    def test_lost_route_response_then_seal_and_accept_preserve_both_generations(self):
        fixture = self.fixture
        fixture.admin.mode = "lost-ack"
        with self.assertRaises(SwitchUnknown):
            operator.run(self.args)
        activated = operator.run(self.args)
        self.args.action = "seal"
        sealed = operator.run(self.args)
        self.assertEqual(sealed["activationOperationId"], activated["operationId"])
        self.args.action = "accept"
        self.args.projection_sha256, self.args.acceptance_sha256 = sealed["projectionSha256"], sealed["acceptanceSha256"]
        accepted = operator.run(self.args)
        self.assertEqual(accepted["state"], "accepted")
        self.assertEqual(fixture.admin.writes, [fixture.after])
        self.assertEqual(_state(fixture.state / "accepted-web-generation.json")["slot"]["runtime"], fixture.pointer["slot"]["runtime"])
        self.assertGreaterEqual(self.direct.call_count, 2)

    def test_wrong_activation_digest_stops_before_any_route_or_backend_observation(self):
        self.args.core_activation_sha256 = "0" * 64
        with self.assertRaisesRegex(SwitchConflict, "activation plan digest differs"):
            operator.run(self.args)
        self.assertFalse(self.fixture.admin.writes)
        self.install._retained.assert_not_called()

    def test_explicit_reverse_uses_old_backend_authority_after_core_stops(self):
        fixture = self.fixture
        operator.run(self.args)
        self.args.action = "reverse"
        self.install._retained.return_value = {"backendFingerprint": fixture.predecessor["backendFingerprint"]}, None
        rolled_back = operator.run(self.args)
        self.assertEqual(rolled_back["state"], "rolled-back")
        self.assertIsNone(operator.InstalledWebSuccessor.call_args.kwargs["retained_core"])
        self.assertEqual(fixture.admin.writes, [fixture.after, fixture.before])
        self.assertEqual(_state(fixture.state / "accepted-web-generation.json"), fixture.pointer)
