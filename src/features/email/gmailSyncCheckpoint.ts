import { sql } from "drizzle-orm";
import type { AppError } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { ok, type Result } from "@/types/result";
import type { GmailClient } from "./gmailClient";
import { withGmailConnection } from "./gmailConnectionFence";

// Bootstrap from Google's current history cursor. The request is outside the
// persistence fence, so an authority change can finish while Google responds.
export async function seedGmailHistoryCursor(
  db: Db,
  args: { accountId: string; gmail: GmailClient; signal: AbortSignal },
  generation: number,
): Promise<Result<{ applied: number }, AppError>> {
  const profile = await args.gmail.getProfile({ signal: args.signal });
  args.signal.throwIfAborted();
  if (!profile.ok) return profile;
  const checkpoint = await withGmailConnection(db, args.accountId, generation, args.signal, (tx) =>
    tx.execute(sql`
    UPDATE email_accounts SET last_history_id=${profile.value.historyId},last_sync_at=now(),last_error_id=NULL
    WHERE id=${args.accountId}
  `),
  );
  return checkpoint.ok ? ok({ applied: 0 }) : checkpoint;
}
