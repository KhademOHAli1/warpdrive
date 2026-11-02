import { sql } from "drizzle-orm";
import { TOKEN_REFRESH_SKEW_SECONDS } from "@/constants/email";
import { AppError } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { err, ok, type Result } from "@/types/result";
import { decryptToken, encryptToken } from "./crypto";

export interface AccessToken {
  token: string;
  expiresAt: number;
  connectionGeneration: number;
  credentialVersion: number;
}

interface RefreshedToken {
  accessToken: string;
  expiresIn: number;
  refreshToken?: string;
}
interface RefreshDeps {
  refresh: (refreshToken: string, signal: AbortSignal) => Promise<Result<RefreshedToken, AppError>>;
}
interface TokenSnapshot {
  user_id: string;
  refresh_token_enc: Buffer;
  connection_generation: number;
  credential_version: number;
}

const unavailable = () => err(new AppError("E_GMAIL_002", "no usable current Gmail grant", {}));

async function finishRefresh(
  db: Db,
  accountId: string,
  snapshot: TokenSnapshot,
  refreshed: Result<RefreshedToken, AppError>,
  signal: AbortSignal,
): Promise<Result<number, AppError>> {
  return db.transaction(async (tx) => {
    // A short commit phase fences HTTP work against suspension and reconnect.
    // Never hold a mailbox/owner lock across the provider request.
    const owner = (
      await tx.execute(sql`
      SELECT is_active,invited_at FROM users WHERE id=${snapshot.user_id} FOR NO KEY UPDATE
    `)
    ).rows[0] as { is_active: boolean; invited_at: Date | null } | undefined;
    signal.throwIfAborted();
    if (owner === undefined || !owner.is_active || owner.invited_at !== null) return unavailable();
    if (!refreshed.ok) {
      if (refreshed.error.id === "E_GMAIL_002")
        await tx.execute(sql`
        UPDATE email_accounts SET status='disconnected',last_error_id='E_GMAIL_002',
          refresh_token_enc=NULL,connection_generation=connection_generation+1,credential_version=credential_version+1,updated_at=now()
        WHERE id=${accountId} AND user_id=${snapshot.user_id} AND provider='gmail'
          AND status='connected' AND NOT paused AND connection_generation=${snapshot.connection_generation}
          AND credential_version=${snapshot.credential_version} AND refresh_token_enc=${snapshot.refresh_token_enc}
      `);
      signal.throwIfAborted();
      return refreshed;
    }
    const rotated = refreshed.value.refreshToken;
    const token = rotated === undefined ? snapshot.refresh_token_enc : encryptToken(rotated);
    const updated = (
      await tx.execute(sql`
      UPDATE email_accounts SET refresh_token_enc=${token},
        credential_version=credential_version+${rotated === undefined ? 0 : 1},updated_at=now()
      WHERE id=${accountId} AND user_id=${snapshot.user_id} AND provider='gmail'
        AND status='connected' AND NOT paused AND connection_generation=${snapshot.connection_generation}
        AND credential_version=${snapshot.credential_version} AND refresh_token_enc=${snapshot.refresh_token_enc}
      RETURNING credential_version
    `)
    ).rows[0] as { credential_version: number } | undefined;
    signal.throwIfAborted();
    return updated === undefined ? unavailable() : ok(updated.credential_version);
  });
}

// Cached tokens also require live authority and a matching connection generation.
// Key failures and transient provider errors never destroy the stored grant.
export async function ensureAccessToken(
  db: Db,
  args: {
    accountId: string;
    signal: AbortSignal;
    cached?: AccessToken;
    now?: number;
    deps: RefreshDeps;
  },
): Promise<Result<AccessToken, AppError>> {
  const { signal } = args;
  signal.throwIfAborted();
  const loaded = await db.execute(sql`
    SELECT a.user_id,a.refresh_token_enc,a.connection_generation,a.credential_version FROM email_accounts a
    JOIN users u ON u.id=a.user_id
    WHERE a.id=${args.accountId} AND a.provider='gmail' AND a.status='connected' AND NOT a.paused
      AND a.refresh_token_enc IS NOT NULL AND u.is_active AND u.invited_at IS NULL
  `);
  signal.throwIfAborted();
  const snapshot = loaded.rows[0] as TokenSnapshot | undefined;
  if (snapshot === undefined) return unavailable();
  const now = args.now ?? Date.now();
  if (
    args.cached !== undefined &&
    args.cached.connectionGeneration === snapshot.connection_generation &&
    args.cached.credentialVersion === snapshot.credential_version &&
    args.cached.expiresAt - now > TOKEN_REFRESH_SKEW_SECONDS * 1000
  )
    return ok(args.cached);
  const decoded = decryptToken(snapshot.refresh_token_enc);
  if (!decoded.ok) return decoded;
  let refreshed: Result<RefreshedToken, AppError>;
  try {
    refreshed = await args.deps.refresh(decoded.value, signal);
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof Error && error.name === "AbortError") throw error;
    return err(new AppError("E_GMAIL_001", "gmail refresh unavailable", {}));
  }
  signal.throwIfAborted();
  const committed = await finishRefresh(db, args.accountId, snapshot, refreshed, signal);
  if (!committed.ok) return committed;
  if (!refreshed.ok) return refreshed;
  return ok({
    token: refreshed.value.accessToken,
    expiresAt: now + refreshed.value.expiresIn * 1000,
    connectionGeneration: snapshot.connection_generation,
    credentialVersion: committed.value,
  });
}
