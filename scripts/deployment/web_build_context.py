"""Materialize a Web build context from exact Git blobs, away from the worktree."""

import argparse
from hashlib import sha1
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tarfile

from candidate import require
from component_inputs import MAX_FILE_BYTES, MAX_TOTAL_BYTES, content_hash, safe_path
from web_release_build import checkout, private_destination
from web_release_inputs import GIT, _tree


def _blob_id(data):
    header = f"blob {len(data)}\0".encode("ascii")
    digest = sha1(header, usedforsecurity=False)
    digest.update(data)
    return digest.hexdigest()


def _context_tree(root, revision):
    checkout(root, revision)
    tree = _tree(root, revision)
    require(all(mode in ("100644", "100755") and kind == "blob" for mode, kind, _ in tree.values()),
            "Only regular tracked files may enter the Web build context")
    require(".dockerignore" in tree and "deploy/images/Web.Dockerfile" in tree
            and "deploy/images/Web.Dockerfile.dockerignore" not in tree,
            "The selected Web recipe requires the shared tracked Docker exclusion rules")
    return tree


def _selected_tests(tree, paths):
    require(type(paths) in (list, tuple) and len(paths) <= 256, "Bounded Web context test exclusions required")
    excluded = {}
    for path in paths:
        safe_path(path)
        record = tree.get(path)
        require(path.startswith("src/") and path.endswith((".test.ts", ".test.tsx"))
                and record is not None and record[:2] == ("100644", "blob") and path not in excluded,
                "Web context exclusions require unique regular tracked src test files")
        excluded[path] = record
    return excluded


def _directories(tree):
    return {parent.as_posix() for path in tree for parent in Path(path).parents if parent != Path(".")}


def _inventory_hash(tree):
    return content_hash({path: list(record) for path, record in tree.items()})


def prepare_context(root, revision, destination, *, exclude_tests=()):
    """Validate the full archive, omitting only the caller's admitted test paths."""
    private_destination(destination, root)
    tree = _context_tree(root, revision)
    excluded = _selected_tests(tree, exclude_tests)
    archive_directories = _directories(tree)
    retained_directories = _directories(tree.keys() - excluded.keys()) if excluded else archive_directories
    destination.mkdir(mode=0o700)
    environment = {key: os.environ[key] for key in ("PATH", "HOME", "TMPDIR") if key in os.environ}
    with subprocess.Popen([*GIT, "archive", "--format=tar", revision], cwd=root, env=environment,
                          stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL) as process:
        try:
            with tarfile.open(fileobj=process.stdout, mode="r|") as archive:
                files = set()
                directories = set()
                total = 0
                for member in archive:
                    path = member.name
                    if member.isdir():
                        require(path in archive_directories and path not in directories, "Unexpected Git archive directory")
                        if path in retained_directories:
                            directory = destination / path
                            directory.mkdir(mode=0o700)
                            # BuildKit preserves modes copied into the non-root image.
                            directory.chmod(0o755)
                        directories.add(path)
                        continue
                    require(member.isfile() and path in tree and path not in files and 0 <= member.size <= MAX_FILE_BYTES,
                            "Unexpected Git archive member")
                    total += member.size
                    require(total <= MAX_TOTAL_BYTES, "Web build context exceeds its byte budget")
                    with archive.extractfile(member) as source:
                        data = source.read(member.size + 1)
                    mode, _, oid = tree[path]
                    require(len(data) == member.size and _blob_id(data) == oid, "Git archive changed tracked input bytes")
                    target = destination / path
                    require(target.parent == destination or target.parent.relative_to(destination).as_posix() in directories,
                            "Git archive file appeared before its directory")
                    if path not in excluded:
                        with target.open("xb") as output:
                            output.write(data)
                        target.chmod(0o755 if mode == "100755" else 0o644)
                    files.add(path)
                require(files == tree.keys() and directories == archive_directories, "Git archive omitted tracked Web build inputs")
            require(process.wait(timeout=5) == 0, "Git archive did not complete")
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=5)
    return verify_context(root, revision, destination, exclude_tests=exclude_tests)


def verify_context(root, revision, destination, *, exclude_tests=()):
    """Recheck the exact projected directory and bind omissions to Git records."""
    require(destination.is_absolute() and destination == destination.resolve(strict=True) and destination.is_dir()
            and destination.stat().st_uid == os.geteuid() and stat.S_IMODE(destination.stat().st_mode) == 0o700
            and not destination.is_relative_to(root), "Separate owned build context required")
    tree = _context_tree(root, revision)
    excluded = _selected_tests(tree, exclude_tests)
    retained = {path: record for path, record in tree.items() if path not in excluded}
    expected_directories = _directories(retained)
    directories = set()
    files = set()
    total = 0
    for base, names, members in os.walk(destination, followlinks=False):
        for name in names:
            path = Path(base, name)
            info = path.lstat()
            relative = path.relative_to(destination).as_posix()
            require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.geteuid()
                    and stat.S_IMODE(info.st_mode) == 0o755
                    and relative in expected_directories, "Unexpected Web context directory or mode")
            directories.add(relative)
        for name in members:
            path = Path(base, name)
            key = path.relative_to(destination).as_posix()
            require(key not in excluded, "Excluded test entered the isolated Web build context")
            require(key in retained, "Untracked file entered the isolated Web build context")
            mode, _, oid = retained[key]
            descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(descriptor, "rb") as source:
                info = os.fstat(descriptor)
                require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == os.geteuid()
                        and stat.S_IMODE(info.st_mode) == (0o755 if mode == "100755" else 0o644)
                        and info.st_size <= MAX_FILE_BYTES, "Web context file type, mode or size changed")
                total += info.st_size
                require(total <= MAX_TOTAL_BYTES, "Web build context exceeds its byte budget")
                data = source.read(info.st_size + 1)
                after = os.fstat(descriptor)
                require(info.st_mtime_ns == after.st_mtime_ns and info.st_ctime_ns == after.st_ctime_ns
                        and os.path.samestat(info, path.lstat()) and len(data) == info.st_size and _blob_id(data) == oid,
                        "Web context bytes differ from exact source")
            files.add(key)
    require(files == retained.keys() and directories == expected_directories and _context_tree(root, revision) == tree,
            "Web build context inventory changed")
    result = {"schemaVersion": 2 if excluded else 1, "kind": "warpdrive-web-build-context", "sourceRevision": revision,
              "gitInventorySha256": _inventory_hash(tree), "fileCount": len(retained),
              "contextDirectory": str(destination), "dockerfile": str(destination / "deploy/images/Web.Dockerfile"),
              "deploymentAuthorized": False}
    if excluded:
        paths = sorted(excluded)
        result.update(contextInventorySha256=_inventory_hash(retained), excludedTests=paths,
                      excludedTestCount=len(paths), excludedTestPathsSha256=content_hash(paths),
                      excludedTestsSha256=_inventory_hash(excluded))
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("prepare", "verify"))
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--destination", type=Path, required=True)
    parser.add_argument("--exclude-test", action="append", default=[], help="exact structurally changed candidate test path")
    args = parser.parse_args(argv)
    try:
        handler = prepare_context if args.action == "prepare" else verify_context
        result = handler(args.root, args.revision, args.destination, exclude_tests=args.exclude_test)
    except (OSError, ValueError, RuntimeError, tarfile.TarError, subprocess.SubprocessError) as error:
        print(f"Web build context held ({type(error).__name__}): {error}", file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
