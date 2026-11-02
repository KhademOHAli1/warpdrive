import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const fixtureBase = fileURLToPath(
  new URL("../../../../.runtime/agency-persistence-main-base/", import.meta.url),
);

export type AgencyFixtureSource = Readonly<{
  verify: (signal: AbortSignal) => Promise<{
    base: string;
    manifest: Readonly<{ sourceHead: string; expectedLastTag: string }>;
  }>;
}>;

// A verifier closes over its own base. Setup never accepts an independent base override.
export function createAgencyFixtureSource<const LastTag extends string>(
  options: Readonly<{
    base: string;
    expectedLastTag: LastTag;
    journalEntries: number;
    expectedSourceHead?: string;
  }>,
) {
  const { base, expectedLastTag, journalEntries, expectedSourceHead } = options;
  const fixtureSchema = z.object({
    schemaVersion: z.literal(1),
    sourceHead:
      expectedSourceHead === undefined
        ? z.string().regex(/^[a-f0-9]{40}$/)
        : z.literal(expectedSourceHead),
    expectedLastTag: z.literal(expectedLastTag),
    files: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)),
  });
  const journalSchema = z.object({
    entries: z
      .array(
        z.object({
          idx: z.number().int().nonnegative(),
          tag: z.string().regex(/^\d{4}_[a-z0-9_]+$/),
        }),
      )
      .length(journalEntries),
  });

  return {
    async verify(signal: AbortSignal) {
      const manifest = fixtureSchema.parse(
        JSON.parse(
          await readFile(resolve(base, "manifest.json"), {
            encoding: "utf8",
            signal,
          }),
        ),
      );
      const loaded = new Map<string, string>();
      for (const [relative, expected] of Object.entries(manifest.files)) {
        if (
          !relative.startsWith("drizzle/") ||
          relative.includes("\\") ||
          relative.split("/").some((part) => part === ".." || part === "." || part.length === 0)
        ) {
          throw new TypeError("Canonical fixture manifest contains an unsafe path");
        }
        const path = resolve(base, relative);
        if (!(await lstat(path)).isFile())
          throw new TypeError("Canonical fixture file is not regular");
        signal.throwIfAborted();
        const bytes = await readFile(path, { signal });
        if (createHash("sha256").update(bytes).digest("hex") !== expected) {
          throw new TypeError(`Canonical fixture hash mismatch: ${relative}`);
        }
        loaded.set(relative, bytes.toString("utf8"));
      }
      const actual = await inventory(resolve(base, "drizzle"), signal);
      const expected = Object.keys(manifest.files)
        .map((path) => resolve(base, path))
        .sort();
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new TypeError("Canonical fixture inventory mismatch");
      }
      const journalText = loaded.get("drizzle/meta/_journal.json");
      if (journalText === undefined) throw new TypeError("Canonical fixture journal is not pinned");
      const journal = journalSchema.parse(JSON.parse(journalText));
      if (
        journal.entries.at(-1)?.tag !== manifest.expectedLastTag ||
        journal.entries.some(
          (entry, index) => entry.idx !== index || !loaded.has(`drizzle/${entry.tag}.sql`),
        )
      ) {
        throw new TypeError(
          `Canonical fixture is not the complete 0000..${expectedLastTag.slice(0, 4)} history`,
        );
      }
      return { base, manifest };
    },
  };
}

async function inventory(folder: string, signal: AbortSignal): Promise<string[]> {
  signal.throwIfAborted();
  const entries = await readdir(folder, { withFileTypes: true });
  signal.throwIfAborted();
  const paths: string[] = [];
  for (const entry of entries) {
    const absolute = resolve(folder, entry.name);
    if (entry.isDirectory()) paths.push(...(await inventory(absolute, signal)));
    else if (entry.isFile()) paths.push(absolute);
    else throw new TypeError("Canonical fixture contains a nonregular path");
  }
  return paths.sort();
}

export const legacyFixtureSource = createAgencyFixtureSource({
  base: fixtureBase,
  expectedLastTag: "0097_private_mail_intake",
  journalEntries: 98,
});

export async function verifyAgencyFixture(signal: AbortSignal) {
  const verified = await legacyFixtureSource.verify(signal);
  return verified.manifest;
}
