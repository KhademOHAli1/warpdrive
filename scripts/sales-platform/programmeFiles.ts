import { lstatSync, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { err, ok, type Result } from "@/types/result";
import type { ProgrammeIssue } from "./programmeSchemas";

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const blockedSegment = /^(?:\.|private$|secrets?$|credentials?$|id_rsa$)|\.(?:pem|key|p12|pfx)$/i;

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
    if (lstatSync(inspected.value).size > MAX_FILE_BYTES)
      return err({ code: "file-size", path, message: "Register file exceeds the 4 MiB limit." });
    const data = await readFile(inspected.value, { signal });
    signal.throwIfAborted();
    return ok(data);
  } catch (error) {
    signal.throwIfAborted();
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
