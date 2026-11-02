import type { ImapFlow } from "imapflow";
import { err, ok, type Result } from "@/types/result";
import { fetchSingleImapMessage } from "./imapFetchOne";
import type { ImapFailure, ImapFolderPage } from "./imapTypes";
import { RAW_MIME_LIMITS } from "./rawMimeTypes";

export type ImapFetchedEntry =
  | { state: "batch_full" }
  | { state: "skipped"; reason: "message_missing" | "message_too_large" }
  | { state: "message"; message: ImapFolderPage["messages"][number] };

function internalDate(value: Date | string | undefined): Date | null {
  if (value === undefined) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function fetchImapEntry(
  client: ImapFlow,
  uid: number,
  remainingBytes: number,
  signal: AbortSignal,
): Promise<Result<ImapFetchedEntry, ImapFailure>> {
  const inspected = await fetchSingleImapMessage(
    client,
    uid,
    {
      uid: true,
      flags: true,
      internalDate: true,
      size: true,
    },
    signal,
  );
  signal.throwIfAborted();
  if (!inspected.ok) return inspected;
  const metadata = inspected.value;
  if (metadata === null) return ok({ state: "skipped", reason: "message_missing" });
  const advertisedSize = metadata.size ?? 0;
  if (advertisedSize > RAW_MIME_LIMITS.messageBytes)
    return ok({ state: "skipped", reason: "message_too_large" });
  if (advertisedSize > remainingBytes) return ok({ state: "batch_full" });
  const source = await fetchSingleImapMessage(client, uid, { uid: true, source: true }, signal);
  signal.throwIfAborted();
  if (!source.ok) return source;
  const fetched = source.value;
  if (fetched === null || fetched.source === undefined)
    return ok({ state: "skipped", reason: "message_missing" });
  if (fetched.source.length > RAW_MIME_LIMITS.messageBytes)
    return err({ kind: "message_too_large" });
  // RFC822.SIZE is untrusted. A lying server must not expand an otherwise bounded page.
  if (fetched.source.length > remainingBytes) return ok({ state: "batch_full" });
  return ok({
    state: "message",
    message: {
      uid,
      source: fetched.source,
      flags: [...(metadata.flags ?? [])],
      internalDate: internalDate(metadata.internalDate),
    },
  });
}
