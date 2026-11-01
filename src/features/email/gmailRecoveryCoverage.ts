import { sql } from "drizzle-orm";
import { RESYNC_WINDOW_MARGIN_SECONDS } from "@/constants/email";
import type { AppError } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { ok, type Result } from "@/types/result";
import type { GmailClient } from "./gmailClient";
import { withGmailConnection } from "./gmailConnectionFence";
import { reconcileThreadTrash } from "./trashReconcile";

// Coverage includes the recent window and every linked thread, including old
// messages whose labels changed while the history cursor was unavailable.
export async function collectGmailRecoveryCoverage(
  db: Db,
  args: {
    accountId: string;
    gmail: GmailClient;
    signal: AbortSignal;
    generation: number;
    lastSyncAt: Date | null;
  },
): Promise<Result<string[], AppError>> {
  const q =
    args.lastSyncAt === null
      ? undefined
      : `after:${Math.floor(new Date(args.lastSyncAt).getTime() / 1000) - RESYNC_WINDOW_MARGIN_SECONDS}`;
  const ids = new Set<string>();
  let pageToken: string | undefined;
  do {
    const listed = await args.gmail.listMessages({ q, pageToken, signal: args.signal });
    args.signal.throwIfAborted();
    if (!listed.ok) return listed;
    for (const message of listed.value.messages) ids.add(message.id);
    pageToken = listed.value.nextPageToken;
  } while (pageToken !== undefined);

  const linked =
    await db.execute(sql`SELECT gmail_thread_id FROM email_threads WHERE account_id=${args.accountId}
    AND (person_id IS NOT NULL OR deal_id IS NOT NULL OR lead_id IS NOT NULL)`);
  args.signal.throwIfAborted();
  for (const row of linked.rows as { gmail_thread_id: string }[]) {
    const thread = await args.gmail.getThread({ id: row.gmail_thread_id, signal: args.signal });
    args.signal.throwIfAborted();
    if (!thread.ok) return thread;
    for (const message of thread.value.messages) ids.add(message.id);
    const written = await withGmailConnection(
      db,
      args.accountId,
      args.generation,
      args.signal,
      (tx) => reconcileThreadTrash(tx, args.accountId, row.gmail_thread_id, thread.value.messages),
    );
    if (!written.ok) return written;
  }
  return ok([...ids]);
}
