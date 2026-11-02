import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { MailboxConnectionError } from "./connections/types";
import { guardImapConnection } from "./imapSyncGuard";
import type { ImapConnectionRuntime } from "./mailConnectionRuntime";

const SYNC_FAILURES = {
  authentication: "E_IMAP_SYNC_AUTHENTICATION",
  tls: "E_IMAP_SYNC_TLS",
  network: "E_IMAP_SYNC_NETWORK",
  permission: "E_IMAP_SYNC_PERMISSION",
  unsupported: "E_IMAP_SYNC_UNSUPPORTED",
  unknown: "E_IMAP_SYNC_UNKNOWN",
} as const;

function failureClass(kind: string): keyof typeof SYNC_FAILURES {
  if (kind === "authentication" || kind === "tls" || kind === "unsupported") return kind;
  if (kind === "read_only") return "permission";
  if (kind === "connection" || kind === "timeout") return "network";
  return "unknown";
}

export function publicImapSyncFailure(code: string | null): MailboxConnectionError | undefined {
  for (const [kind, value] of Object.entries(SYNC_FAILURES)) {
    if (value === code) return kind as keyof typeof SYNC_FAILURES;
  }
  return undefined;
}

// This is current connection health, not a provider diagnostic or a new account status.
// Keep status=connected so the existing retry path remains able to recover the account.
export async function recordImapSyncFailure(
  db: Db,
  runtime: Pick<ImapConnectionRuntime, "accountId" | "ownerId" | "generation">,
  kind: string,
  signal: AbortSignal,
): Promise<void> {
  await db.transaction(async (tx) => {
    if (!(await guardImapConnection(tx, runtime, signal))) return;
    await tx.execute(sql`
      UPDATE email_accounts SET last_error_id=${SYNC_FAILURES[failureClass(kind)]}
      WHERE id=${runtime.accountId} AND user_id=${runtime.ownerId}
        AND connection_generation=${runtime.generation}
    `);
    signal.throwIfAborted();
  });
}

// LIST success retires only this boundary's fixed account codes. It does not
// advance synchronization or erase current/historical folder failure evidence.
export async function retireImapSyncFailure(
  db: Db,
  runtime: Pick<ImapConnectionRuntime, "accountId" | "ownerId" | "generation">,
  signal: AbortSignal,
): Promise<void> {
  await db.transaction(async (tx) => {
    if (!(await guardImapConnection(tx, runtime, signal))) return;
    const ownedCodes = sql.join(
      Object.values(SYNC_FAILURES).map((code) => sql`${code}`),
      sql`, `,
    );
    await tx.execute(sql`
      UPDATE email_accounts SET last_error_id=NULL
      WHERE id=${runtime.accountId} AND user_id=${runtime.ownerId}
        AND connection_generation=${runtime.generation} AND last_error_id IN (${ownedCodes})
    `);
    signal.throwIfAborted();
  });
}
