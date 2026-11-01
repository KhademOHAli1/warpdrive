import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { z } from "zod";
import { err, ok, type Result } from "../../src/types/result";

export const MAX_MIGRATIONS = 4096;
export const JSON_LIMIT = 2 * 1024 * 1024;
export const SQL_LIMIT = 8 * 1024 * 1024;
export type InspectionFailure = { code: string; file?: string };
export type InspectionResult<T> = Result<T, InspectionFailure>;
export const checkoutInput = z.strictObject({
  label: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),
  directory: z.string().min(1).max(4096),
  ledgerFile: z.string().min(1).max(4096).optional(),
});
export type CheckoutInput = z.infer<typeof checkoutInput>;
const timestamp = z.union([
  z.number().int().safe().nonnegative(),
  z
    .string()
    .regex(/^\d{1,16}$/)
    .transform(Number)
    .pipe(z.number().int().safe().nonnegative()),
]);
const journalEntry = z.strictObject({
  idx: z.number().int().nonnegative(),
  version: z.literal("7"),
  when: z.number().int().safe().nonnegative(),
  tag: z.string().regex(/^\d{4}_[A-Za-z0-9_]{1,128}$/),
  breakpoints: z.boolean(),
});
export const journalSchema = z
  .strictObject({
    version: z.literal("7"),
    dialect: z.literal("postgresql"),
    entries: z.array(journalEntry).min(1).max(MAX_MIGRATIONS),
  })
  .refine(({ entries }) => {
    const tags = new Set<string>();
    return entries.every((entry, index) => {
      if (entry.idx !== index || Number(entry.tag.slice(0, 4)) !== index || tags.has(entry.tag))
        return false;
      tags.add(entry.tag);
      const previous = entries[index - 1];
      return previous === undefined || entry.when > previous.when;
    });
  });
export const ledgerSchema = z.strictObject({
  format: z.literal("drizzle-pg-ledger-v1"),
  rows: z
    .array(
      z.strictObject({
        id: timestamp.optional(),
        hash: z.string().regex(/^[a-f0-9]{64}$/),
        created_at: timestamp,
      }),
    )
    .max(MAX_MIGRATIONS),
});
export type LedgerRow = z.infer<typeof ledgerSchema>["rows"][number];

export function decodeJson(bytes: Buffer, code: string): InspectionResult<unknown> {
  try {
    return ok(JSON.parse(bytes.toString("utf8")) as unknown);
  } catch {
    return err({ code });
  }
}

// Only explicitly requested regular files are opened. No environment or database is consulted.
export async function readBounded(
  file: string,
  limit: number,
  signal: AbortSignal,
  root?: string,
): Promise<InspectionResult<Buffer>> {
  signal.throwIfAborted();
  try {
    const canonical = await realpath(root === undefined ? file : join(root, file));
    signal.throwIfAborted();
    if (root !== undefined) {
      const rel = relative(root, canonical);
      if (rel === ".." || rel.startsWith("../") || isAbsolute(rel))
        return err({ code: "outside-checkout", file });
    }
    // Nonblocking admission lets us reject a FIFO before any read can wait for a writer.
    const handle = await open(
      canonical,
      constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
    );
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.size > limit)
        return err({
          code: "file-limit-or-type",
          file: root === undefined ? "ledger-export" : file,
        });
      const bytes = Buffer.alloc(before.size + 1);
      let read = 0;
      while (read < bytes.length) {
        signal.throwIfAborted();
        const chunk = await handle.read(bytes, read, bytes.length - read, read);
        if (chunk.bytesRead === 0) break;
        read += chunk.bytesRead;
      }
      const after = await handle.stat();
      if (read !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs)
        return err({ code: "file-changed-during-read", file });
      return ok(bytes.subarray(0, read));
    } finally {
      await handle.close();
    }
  } catch {
    signal.throwIfAborted();
    return err({ code: "unreadable-file", file: root === undefined ? "ledger-export" : file });
  }
}
