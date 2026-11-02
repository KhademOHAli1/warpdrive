import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import tracking
from test_tracking import roadmap


class TrackingCliTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.manifest = self.root / "roadmap.json"
        self.manifest.write_text(json.dumps(roadmap()))

    def test_adopt_cli_uses_existing_issue_and_owned_lock(self):
        argv = ["tracking.py", "adopt", "--manifest", str(self.manifest), "--canonical-id", "A", "--issue", "7", "--apply", "--checkpoint", str(self.root / "state.json"), "--mapping", str(self.root / "mapping.json")]
        with patch.object(sys, "argv", argv), patch.object(tracking, "Gh"), patch.object(tracking, "adopt_existing", create=True, return_value={"adopted": True}) as adopt, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(tracking.main(), 0)
        args = adopt.call_args.args[2]
        self.assertEqual((args.canonical_id, args.issue, args.apply), ("A", 7, True))

    def test_snapshot_cli_passes_known_state_and_explicit_partial_policy(self):
        argv = ["tracking.py", "snapshot", "--manifest", str(self.manifest), "--allow-partial", "--checkpoint", str(self.root / "state.json"), "--mapping", str(self.root / "mapping.json"), "--output", str(self.root / "snapshot.json")]
        with patch.object(sys, "argv", argv), patch.object(tracking, "Gh"), patch.object(tracking, "snapshot", return_value={"complete": False}) as snapshot, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(tracking.main(), 0)
        self.assertEqual(snapshot.call_args.kwargs, {"checkpoint_path": str(self.root / "state.json"), "mapping_path": str(self.root / "mapping.json"), "allow_partial": True})
