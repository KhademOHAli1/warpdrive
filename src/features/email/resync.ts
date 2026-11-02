import { sql } from "drizzle-orm";
import type { AppError } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { ok, type Result } from "@/types/result";
import { applyMessageIds } from "./applyMessages";
import type { GmailClient } from "./gmailClient";
import { readGmailConnection, withGmailConnection } from "./gmailConnectionFence";
import { collectGmailRecoveryCoverage } from "./gmailRecoveryCoverage";
import { hydrateOwner } from "./syncCursor";

// Full ops-B3 gap recovery. Called when historyList returns 404 (expired cursor).
// Invariant: cursor advances ONLY after coverage is complete. If any step fails,
// status stays 'error' and last_history_id is unchanged so the next tick re-drives.
export async function recoverFrom404(
  db: Db,
  args: { accountId: string; gmail: GmailClient; signal: AbortSignal; expectedGeneration?: number },
): Promise<Result<{ applied: number }, AppError>> {
  args.signal.throwIfAborted();

  const acct = await readGmailConnection(db, args.accountId, args.signal, args.expectedGeneration);
  if (acct === null) return ok({ applied: 0 });
  const generation = acct.connection_generation;

  // Mark sync-gap: cursor PRESERVED, status set to 'error' so UI surfaces it.
  const gap = await withGmailConnection(db, args.accountId, generation, args.signal, (tx) =>
    tx.execute(sql`
    UPDATE email_accounts
    SET status='error', last_error_id='E_SYNC_001'
    WHERE id=${args.accountId}
  `),
  );
  if (!gap.ok) return gap;
  args.signal.throwIfAborted();

  const ownerResult = await hydrateOwner(db, acct.user_id, args.signal);
  if (!ownerResult.ok) return ownerResult;
  const owner = ownerResult.value;

  const coverage = await collectGmailRecoveryCoverage(db, {
    ...args,
    generation,
    lastSyncAt: acct.last_sync_at,
  });
  if (!coverage.ok) return coverage;

  // Apply all collected ids. On failure: status stays 'error', cursor not advanced.
  const ap = await applyMessageIds(
    {
      db,
      accountId: args.accountId,
      owner,
      gmail: args.gmail,
      signal: args.signal,
      expectedGeneration: generation,
    },
    coverage.value,
  );
  if (!ap.ok) return ap;

  // Fetch the current cursor from Gmail AFTER coverage is complete.
  const profileResult = await args.gmail.getProfile({ signal: args.signal });
  args.signal.throwIfAborted();
  if (!profileResult.ok) return profileResult; // NO cursor advance

  // Coverage complete: advance cursor and clear error state.
  const checkpoint = await withGmailConnection(db, args.accountId, generation, args.signal, (tx) =>
    tx.execute(sql`
    UPDATE email_accounts
    SET last_history_id=${profileResult.value.historyId},
        status='connected',
        last_error_id=NULL,
        last_sync_at=now()
    WHERE id=${args.accountId}
  `),
  );
  if (!checkpoint.ok) return checkpoint;
  args.signal.throwIfAborted();

  return ok({ applied: ap.value });
}
