"""Keep the exact candidate archive pinned until stage acknowledgement completes."""

import unittest

from installed_web_stage_ack import _pinned_archive
import test_web_candidate as fixture_tools
from web_candidate import ARCHIVE, CandidateError


class InstalledWebStageAckTests(unittest.TestCase):
    def test_archive_inode_replacement_refuses_ack_even_with_identical_bytes(self):
        fixture = fixture_tools.WebCandidateTests()
        self.addCleanup(fixture.doCleanups)
        fixture.setUp()
        admitted = fixture.pack()
        release = {"image": admitted["candidate"]["image"], "provenance": admitted["provenance"]}
        archive = fixture.output / ARCHIVE
        archive.chmod(0o600)

        with _pinned_archive(fixture.output, release) as facts:
            self.assertEqual(facts["config"]["architecture"], "amd64")

        replacement = fixture.private / "replacement.tar"
        replacement.write_bytes(archive.read_bytes())
        replacement.chmod(0o600)
        with self.assertRaisesRegex(CandidateError, "Web bundle file changed during readback"):
            with _pinned_archive(fixture.output, release):
                replacement.replace(archive)
