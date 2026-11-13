"""Readback serializes with the writer and never creates missing locks."""

import fcntl
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from installed_web_readback_lock import installed_web_readback_locks
from web_switch import SwitchConflict


class InstalledWebReadbackLockTests(unittest.TestCase):
    def setUp(self):
        directory = Path(self.enterContext(TemporaryDirectory())).resolve()
        self.original, self.state = directory / "original", directory / "rollout"
        for path in (self.original, self.state):
            path.mkdir(mode=0o700)
        self.production = self.original / "production-operation.lock"
        self.target = self.state / "target.lock"

    def test_takes_only_existing_protected_locks(self):
        with self.assertRaises(FileNotFoundError), installed_web_readback_locks(self.original, self.state):
            self.fail("Missing lock was accepted")
        self.assertEqual(list(self.original.iterdir()), [])
        self.assertEqual(list(self.state.iterdir()), [])
        for path in (self.production, self.target):
            path.touch(mode=0o600)
        with installed_web_readback_locks(self.original, self.state):
            for path in (self.production, self.target):
                with path.open("rb") as descriptor, self.assertRaises(BlockingIOError):
                    fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            descriptor = os.open(self.original, os.O_RDONLY | os.O_DIRECTORY)
            try:
                with self.assertRaises(BlockingIOError):
                    fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            finally:
                os.close(descriptor)
        self.assertEqual([path.stat().st_size for path in (self.production, self.target)], [0, 0])

    def test_busy_or_relinked_target_refuses_readback(self):
        self.production.touch(mode=0o600)
        self.target.touch(mode=0o600)
        with self.target.open("rb") as descriptor:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaisesRegex(SwitchConflict, "Another operation"), installed_web_readback_locks(self.original, self.state):
                self.fail("Busy lock was accepted")
        with self.production.open("rb") as descriptor:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.target.unlink()
        self.target.symlink_to(self.production)
        with self.assertRaises(OSError), installed_web_readback_locks(self.original, self.state):
            self.fail("Symlink lock was accepted")
