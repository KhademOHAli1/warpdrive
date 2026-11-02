import { constants, lstatSync, realpathSync, type Stats } from "node:fs";
import { type FileHandle, open } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { err, ok, type Result } from "@/types/result";
import type { ProgrammeIssue } from "./programmeSchemas";

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const blockedSegment = /^(?:\.|private$|secrets?$|credentials?$|id_rsa$)|\.(?:pem|key|p12|pfx)$/i;

function sameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameVersion(left: Stats, right: Stats): boolean {
  return (
    sameFile(left, right) &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function unsafeFile(path: string): Result<never, ProgrammeIssue> {
  return err({
    code: "unsafe-path",
    path,
    message: "The file changed while it was being read.",
  });
}

function oversizedFile(path: string): Result<never, ProgrammeIssue> {
  return err({ code: "file-size", path, message: "Register file exceeds the 4 MiB limit." });
}

function unchangedPath(
  root: string,
  path: string,
  inspectedPath: string,
  opened: Stats,
  signal: AbortSignal,
): Result<undefined, ProgrammeIssue> {
  const current = inspectFile(root, path, signal);
  if (!current.ok) return current;
  if (current.value !== inspectedPath || !sameVersion(lstatSync(current.value), opened))
    return unsafeFile(path);
  return ok(undefined);
}

async function readBounded(
  handle: FileHandle,
  path: string,
  signal: AbortSignal,
): Promise<Result<Buffer, ProgrammeIssue>> {
  // A file can grow after fstat. Read at most one byte beyond the limit so
  // concurrent growth is reported without ever buffering unbounded content.
  const buffer = Buffer.allocUnsafe(MAX_FILE_BYTES + 1);
  let length = 0;
  while (length < buffer.length) {
    signal.throwIfAborted();
    const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
    signal.throwIfAborted();
    if (bytesRead === 0) break;
    length += bytesRead;
  }
  return length > MAX_FILE_BYTES ? oversizedFile(path) : ok(buffer.subarray(0, length));
}

async function readVerifiedHandle(
  handle: FileHandle,
  root: string,
  path: string,
  inspectedPath: string,
  before: Stats,
  signal: AbortSignal,
): Promise<Result<Buffer, ProgrammeIssue>> {
  signal.throwIfAborted();
  const opened = await handle.stat();
  if (!opened.isFile() || !sameVersion(before, opened)) return unsafeFile(path);
  if (opened.size > MAX_FILE_BYTES) return oversizedFile(path);

  const current = unchangedPath(root, path, inspectedPath, opened, signal);
  if (!current.ok) return current;
  const data = await readBounded(handle, path, signal);
  if (!data.ok) return data;

  const finished = await handle.stat();
  if (!finished.isFile() || !sameVersion(opened, finished)) return unsafeFile(path);
  if (finished.size > MAX_FILE_BYTES) return oversizedFile(path);
  if (finished.size !== opened.size || finished.size !== data.value.length) return unsafeFile(path);
  const remaining = unchangedPath(root, path, inspectedPath, opened, signal);
  if (!remaining.ok) return remaining;
  signal.throwIfAborted();
  return data;
}

// Evidence references are checked for existence only. Secret/configuration content is never needed.
export function inspectFile(
  root: string,
  path: string,
  signal: AbortSignal,
): Result<string, ProgrammeIssue> {
  signal.throwIfAborted();
  const segments = path.split("/");
  if (
    isAbsolute(path) ||
    path.includes("\\") ||
    path.includes("\0") ||
    segments.some((part) => part === "" || part === ".." || blockedSegment.test(part))
  ) {
    return err({
      code: "unsafe-path",
      path,
      message: "Only non-secret repository-relative regular files are allowed.",
    });
  }
  try {
    let current = root;
    for (const segment of segments) {
      current = join(current, segment);
      if (lstatSync(current).isSymbolicLink())
        return err({
          code: "unsafe-path",
          path,
          message: "Symbolic links are not evidence files.",
        });
    }
    const resolved = realpathSync(current);
    const within = relative(realpathSync(root), resolved);
    if (within.startsWith(`..${sep}`) || isAbsolute(within) || !lstatSync(resolved).isFile())
      return err({
        code: "unsafe-path",
        path,
        message: "The file must remain inside the selected repository.",
      });
    return ok(resolved);
  } catch {
    return err({ code: "missing-file", path, message: "Required regular file is unavailable." });
  }
}

export async function readProgrammeFile(
  root: string,
  path: string,
  signal: AbortSignal,
): Promise<Result<Buffer, ProgrammeIssue>> {
  const inspected = inspectFile(root, path, signal);
  if (!inspected.ok) return inspected;
  try {
    const before = lstatSync(inspected.value);
    if (!before.isFile()) return unsafeFile(path);
    if (before.size > MAX_FILE_BYTES) return oversizedFile(path);

    // O_NOFOLLOW rejects a swapped leaf symlink. O_NONBLOCK keeps a swapped FIFO
    // from hanging the verifier before fstat can reject it as a non-regular file.
    const handle = await open(
      inspected.value,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      return await readVerifiedHandle(handle, root, path, inspected.value, before, signal);
    } finally {
      await handle.close();
    }
  } catch (error) {
    signal.throwIfAborted();
    const current = inspectFile(root, path, signal);
    if (!current.ok && current.error.code === "unsafe-path") return current;
    return err({
      code: "missing-file",
      path,
      message:
        error instanceof Error
          ? "Register file could not be read."
          : "Register file is unavailable.",
    });
  }
}
