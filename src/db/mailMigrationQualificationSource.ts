import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect } from "vitest";
import { journalSchema, type JournalEntry } from "../../scripts/mail-migration-merge";
import { MAIL_MIGRATION_BASELINE } from "./mailMigrationQualificationBaseline";
import { qualificationSettles } from "./mailMigrationQualificationDeadline";

const execute = promisify(execFile);
export const QUALIFICATION_ROOT = fileURLToPath(new URL("../../", import.meta.url));
export function qualificationHash(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function writeInputs(
  target: string, journal: string, entries: JournalEntry[],
  bodies: Map<string, Buffer>, signal: AbortSignal,
): Promise<void> {
  await mkdir(join(target, "meta"), { recursive: true });
  signal.throwIfAborted();
  await writeFile(join(target, "meta/_journal.json"), journal, { signal });
  for (const entry of entries) {
    const bytes = bodies.get(entry.tag);
    expect(bytes).toBeDefined();
    if (bytes !== undefined)
      await writeFile(join(target, entry.tag + ".sql"), bytes, { signal });
  }
}

export async function qualificationSources(signal: AbortSignal) {
  const repositoryFolder = join(QUALIFICATION_ROOT, "drizzle");
  const rawJournal = await readFile(join(repositoryFolder, "meta/_journal.json"), { signal });
  const decoded: unknown = JSON.parse(rawJournal.toString());
  const journal = journalSchema.parse(decoded);
  // Required release gate, not an optional alias branch on a pre91 source tree.
  expect(journal.entries.at(-1)?.idx).toBeGreaterThanOrEqual(91);
  const prefix = (end: number) => ({ ...journal, entries: journal.entries.slice(0, end + 1) });
  expect(qualificationHash(JSON.stringify(prefix(82)))).toBe(MAIL_MIGRATION_BASELINE.journal82);
  expect(qualificationHash(JSON.stringify(prefix(84)))).toBe(MAIL_MIGRATION_BASELINE.journal84);
  const baseSnapshot = await readFile(join(repositoryFolder, "meta/0082_snapshot.json"), { signal });
  expect(qualificationHash(baseSnapshot)).toBe(MAIL_MIGRATION_BASELINE.snapshot82);
  const aliasSnapshot = await readFile(join(repositoryFolder, "meta/0091_snapshot.json"), { signal });
  const bodies = new Map<string, Buffer>();
  const hashes: { idx: number; tag: string; when: number; hash: string }[] = [];
  for (const [index, entry] of journal.entries.entries()) {
    expect(entry.idx).toBe(index);
    expect(entry.tag.startsWith(String(index).padStart(4, "0") + "_")).toBe(true);
    if (index > 84)
      expect(entry.when).toBeGreaterThan(journal.entries[index - 1]?.when ?? Infinity);
    const bytes = await readFile(join(repositoryFolder, entry.tag + ".sql"), { signal });
    const hash = qualificationHash(bytes);
    const frozen = MAIL_MIGRATION_BASELINE.sql[entry.tag as keyof typeof MAIL_MIGRATION_BASELINE.sql];
    if (index <= 84) expect(hash).toBe(frozen);
    bodies.set(entry.tag, bytes);
    hashes.push({ idx: entry.idx, tag: entry.tag, when: entry.when, hash });
  }
  const head = await execute("git", ["rev-parse", "HEAD"], {
    cwd: QUALIFICATION_ROOT, signal, encoding: "utf8",
  });
  const dirt = await execute("git", ["--no-optional-locks", "status", "--porcelain", "--", "drizzle"], {
    cwd: QUALIFICATION_ROOT, signal, encoding: "utf8",
  });
  expect(head.stdout.trim()).toMatch(/^[a-f0-9]{40,64}$/);
  const temporary = await mkdtemp(join(tmpdir(), "warpdrive-mail-migration-qualification-"));
  try {
    signal.throwIfAborted();
    const folder = join(temporary, "immutable-target");
    await writeInputs(folder, rawJournal.toString(), journal.entries, bodies, signal);
    await writeFile(join(folder, "meta/0082_snapshot.json"), baseSnapshot, { signal });
    await writeFile(join(folder, "meta/0091_snapshot.json"), aliasSnapshot, { signal });
    const prefixes = new Map<number, string>();
    for (const end of [82, 84, 90]) {
      const target = join(temporary, "baseline-" + end);
      const reduced = prefix(end);
      await writeInputs(target, JSON.stringify(reduced), reduced.entries, bodies, signal);
      prefixes.set(end, target);
    }
    const sourceHash = qualificationHash(JSON.stringify(hashes));
    const manifest = {
      sourceHead: head.stdout.trim(), drizzleDirty: dirt.stdout.trim() !== "",
      journalHash: qualificationHash(rawJournal),
      snapshot82Hash: qualificationHash(baseSnapshot),
      snapshot91Hash: qualificationHash(aliasSnapshot),
      sourceHash, migrations: hashes,
    };
    await writeFile(join(temporary, "input-manifest.json"), JSON.stringify(manifest), { signal });
    signal.throwIfAborted();
    return { folder, temporary, prefixes, journal, hashes, manifest,
      head: manifest.sourceHead, dirty: manifest.drizzleDirty, sourceHash };
  } catch (error) {
    if (!await qualificationSettles(() => rm(temporary, { recursive: true, force: true }),5000))
      process.stderr.write("MAIL_MIGRATION_QUALIFICATION_SOURCE_CLEANUP_UNCONFIRMED\n");
    throw error;
  }
}

export type QualificationSources = Awaited<ReturnType<typeof qualificationSources>>;

export async function assertQualificationInputs(source: QualificationSources, folder: string, signal: AbortSignal): Promise<void> {
  const prefix = [...source.prefixes.entries()].find((entry) => entry[1] === folder);
  expect(folder === source.folder || prefix !== undefined).toBe(true);
  const entries = prefix === undefined ? source.journal.entries : source.journal.entries.slice(0,prefix[0] + 1);
  const raw = await readFile(join(folder,"meta/_journal.json"),{signal});
  expect(qualificationHash(raw)).toBe(prefix === undefined ? source.manifest.journalHash : qualificationHash(JSON.stringify({...source.journal,entries})));
  for (const entry of source.hashes.slice(0,entries.length)) {
    const bytes = await readFile(join(folder,entry.tag + ".sql"),{signal});
    expect({tag:entry.tag,hash:qualificationHash(bytes)}).toEqual({tag:entry.tag,hash:entry.hash});
  }
}
