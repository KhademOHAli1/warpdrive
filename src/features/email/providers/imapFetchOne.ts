import type { FetchMessageObject, FetchQueryObject, ImapFlow } from "imapflow";
import { z } from "zod";
import { err, ok, type Result } from "@/types/result";
import { IMAP_LIMITS, type ImapFailure } from "./imapTypes";

const rowSchema = z.object({
  seq: z.number().int().positive(),
  // Unsolicited flag-only rows need not carry UID. Bind them only after a requested
  // UID has established the sequence identity during this one FETCH command.
  uid: z.number().int().min(1).max(4_294_967_295).optional(),
  flags: z.set(z.string()).optional(),
  size: z.number().int().nonnegative().optional(),
  internalDate: z.union([z.date(), z.string()]).optional(),
  source: z.instanceof(Buffer).optional(),
});

export type ImapFetchedMessage = z.infer<typeof rowSchema> & { uid: number };

function mergeSelected(
  row: z.infer<typeof rowSchema>,
  uid: number,
  includeSource: boolean,
  current: ImapFetchedMessage | null,
): Result<ImapFetchedMessage | null, ImapFailure> {
  if (row.uid !== uid && !(row.uid === undefined && row.seq === current?.seq)) return ok(current);
  if (current !== null && current.seq !== row.seq) return err({ kind: "protocol" });
  const result: ImapFetchedMessage = current ?? { uid, seq: row.seq };
  if (row.flags !== undefined) result.flags = row.flags;
  if (row.size !== undefined) result.size = row.size;
  if (row.internalDate !== undefined) result.internalDate = row.internalDate;
  if (includeSource && row.source !== undefined) result.source = row.source;
  return ok(result);
}

function sourceBytes(row: FetchMessageObject): number {
  let bytes = (row.source?.length ?? 0) + (row.headers?.length ?? 0);
  for (const part of row.bodyParts?.values() ?? []) bytes += part.length;
  return bytes;
}

export async function fetchSingleImapMessage(
  client: ImapFlow,
  uid: number,
  query: FetchQueryObject,
  signal: AbortSignal,
): Promise<Result<ImapFetchedMessage | null, ImapFailure>> {
  let result: ImapFetchedMessage | null = null;
  let rows = 0;
  let bytes = 0;
  // fetchOne() accumulates unsolicited rows inside ImapFlow before filtering. The
  // public iterator applies backpressure and lets us retain only one message.
  for await (const raw of client.fetch(String(uid), query, { uid: true })) {
    signal.throwIfAborted();
    rows += 1;
    bytes += sourceBytes(raw);
    if (rows > IMAP_LIMITS.fetchRows || bytes > IMAP_LIMITS.fetchResponseBytes) {
      client.close();
      return err({ kind: "unsupported" });
    }
    const parsed = rowSchema.safeParse(raw);
    if (!parsed.success) {
      client.close();
      return err({ kind: "protocol" });
    }
    const merged = mergeSelected(parsed.data, uid, Boolean(query.source), result);
    if (!merged.ok) {
      client.close();
      return merged;
    }
    result = merged.value;
  }
  signal.throwIfAborted();
  return ok(result);
}
