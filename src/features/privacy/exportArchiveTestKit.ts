import { createHash, randomUUID } from "node:crypto";
import { Readable, Writable } from "node:stream";
import { gunzipSync } from "node:zlib";
import { extract } from "tar-stream";
import { ok } from "@/types/result";
import type { DisclosureManifest } from "./disclosureSchemas";
import type { PrivacyArchiveSource } from "./exportArchive";

export const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export interface FixtureEntry {
  path: string;
  body: Buffer;
}
export function archiveFixture(): { manifest: DisclosureManifest; entries: FixtureEntry[] } {
  const recordId = randomUUID();
  const entries = [
    {
      path: `records/${recordId}/مخاطب.json`,
      body: Buffer.from(JSON.stringify({ name: "مخاطب آزمایشی" }), "utf8"),
    },
    {
      path: `attachments/${recordId}/Ergänzung.txt`,
      body: Buffer.from("Synthetic attachment\n", "utf8"),
    },
  ];
  const manifest: DisclosureManifest = {
    formatVersion: 1,
    encoding: "utf-8",
    approvalId: randomUUID(),
    mode: "access",
    locale: "fa",
    generatedAt: "2026-10-31T12:00:00.000Z",
    state: "reviewed",
    blockers: [],
    binding: {
      caseId: randomUUID(),
      subjectId: randomUUID(),
      scopeId: randomUUID(),
      scopeVersion: 1,
      scopeHash: "a".repeat(64),
      policyVersion: 1,
      policyGeneration: 1,
      recipientVersion: 1,
      verificationVersion: 1,
    },
    categories: [
      {
        id: "contacts",
        sourceStore: "table:persons",
        disposition: "include",
        reviewed: true,
        reviewId: randomUUID(),
        thirdParty: "none",
        portabilityEligible: true,
        transformations: [],
        email: { original: "not_applicable", exported: "not_applicable" },
        recordCount: 1,
        files: entries.map((entry) => ({
          path: entry.path,
          sha256: hash(entry.body),
          bytes: entry.body.length,
          recordIds: [recordId],
          recordCount: 1,
          representation: "attachment",
        })),
      },
    ],
  };
  return { manifest, entries };
}

export function entrySources(
  entries: readonly FixtureEntry[],
  beforeOpen?: () => void,
): AsyncIterable<PrivacyArchiveSource> {
  return {
    [Symbol.asyncIterator]: () => {
      let index = 0;
      return {
        next: () => {
          const entry = entries[index++];
          if (entry === undefined)
            return Promise.resolve({ done: true as const, value: undefined });
          return Promise.resolve({
            done: false as const,
            value: {
              path: entry.path,
              open: () => {
                beforeOpen?.();
                return Promise.resolve(ok(Readable.from([entry.body])));
              },
            },
          });
        },
      };
    },
  };
}

export function collectSink() {
  const chunks: Buffer[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  return { stream, bytes: () => Buffer.concat(chunks) };
}

export async function readArchive(bytes: Buffer): Promise<Map<string, Buffer>> {
  const extractor = extract();
  const files = new Map<string, Buffer>();
  extractor.on("entry", (header, stream, next) => {
    const parts: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => parts.push(chunk));
    stream.once("end", () => {
      files.set(header.name, Buffer.concat(parts));
      next();
    });
    stream.resume();
  });
  await new Promise<void>((resolve, reject) => {
    extractor.once("finish", resolve);
    extractor.once("error", reject);
    extractor.end(gunzipSync(bytes));
  });
  return files;
}

export function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}
