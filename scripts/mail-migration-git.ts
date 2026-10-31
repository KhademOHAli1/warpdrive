import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";

const execute = promisify(execFile);
export const commitSchema = z.string().regex(/^[a-f0-9]{40}$/);
const treeLine = z
  .string()
  .regex(
    /^100644 blob [a-f0-9]{40}\tdrizzle\/(?:[0-9]{4}_[a-z0-9_]+\.sql|meta\/(?:[0-9]{4}_snapshot\.json|_journal\.json))$/,
  );

export async function gitText(root: string, args: string[], signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  const result = await execute("git", ["-C", root, ...args], {
    signal,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  signal.throwIfAborted();
  return result.stdout;
}

export async function gitBlob(
  root: string,
  ref: string,
  path: string,
  signal: AbortSignal,
): Promise<Buffer> {
  return Buffer.from(await gitText(root, ["show", `${ref}:${path}`], signal));
}

export async function gitDrizzleTree(
  root: string,
  ref: string,
  signal: AbortSignal,
): Promise<Map<string, string> | null> {
  const raw = await gitText(root, ["ls-tree", "-r", ref, "--", "drizzle"], signal);
  const parsed = z.array(treeLine).safeParse(raw.trimEnd().split("\n"));
  if (!parsed.success) return null;
  return new Map(parsed.data.map((line) => [line.slice(53), line.slice(12, 52)]));
}

export function sqlOrSnapshotIndex(path: string): number | null {
  const match = /^drizzle\/(?:meta\/)?(\d{4})_/.exec(path);
  return match === null ? null : Number(match[1]);
}

export function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function gitBlobHash(bytes: Buffer): string {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}
