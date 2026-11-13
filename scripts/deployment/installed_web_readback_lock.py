"""Coordinate observation with the same locks as installed Web mutations."""

from contextlib import contextmanager
import fcntl
import os
import stat

from installed_web_chain import _directory
from web_switch import SwitchConflict, require


@contextmanager
def _existing_lock(path, modes, *, directory=False):
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
    descriptor = os.open(path, flags | os.O_DIRECTORY if directory else flags)
    try:
        def check():
            info = os.fstat(descriptor)
            kind = stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode) and info.st_nlink == 1
            require(kind and info.st_uid == os.geteuid() and stat.S_IMODE(info.st_mode) in modes
                    and os.path.samestat(info, path.lstat()),
                    "Exact existing installed Web lock required")

        check()
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise SwitchConflict("Another operation owns the installed Web lock") from error
        check()
        yield
        check()
    finally:
        os.close(descriptor)


@contextmanager
def installed_web_readback_locks(original, state):
    """Hold existing shared production and target locks without creating files."""
    for directory in (original, state):
        _directory(directory)
    require(original != state, "Distinct installed Web production and target lock scopes required")
    with _existing_lock(original / "production-operation.lock", (0o600, 0o644)):
        with _existing_lock(original, (0o700,), directory=True):
            with _existing_lock(state / "target.lock", (0o600,)):
                yield
