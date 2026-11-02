import { createHash, randomUUID } from "node:crypto";
import { seedUser } from "@/db/testing/factories";
import type { TestDb } from "@/test/db";
import type { ConsumedCalendarAuthorization } from "./accountAuthorizationState";
import { calendarTestConfig, calendarTestScope } from "./accountTestHelpers";
import { encryptCalendarSecret } from "./tokenCrypto";

interface LegacyAttempt {
  name: string;
  stateHash: string;
  targeted: boolean;
  consumed: boolean;
  cancelledAt: Date | null;
  verifier: Buffer | null;
}
export interface UpgradedLegacyAttempt {
  stateHash: string;
  pin: number | null;
  snapshot: unknown;
  cancelledAt: Date | null;
  consumedAt: Date | null;
  verifier: Buffer | null;
}

function legacyAttempt(name: string, targeted: boolean, consumed: boolean): LegacyAttempt {
  return {
    name,
    stateHash: createHash("sha256").update(name).digest("hex"),
    targeted,
    consumed,
    cancelledAt: null,
    verifier: consumed ? null : encryptCalendarSecret(`synthetic-${name}-verifier`),
  };
}

export async function seedLegacyCalendarState(ctx: TestDb, signal: AbortSignal) {
  const owner = await seedUser(ctx.db);
  const accountId = randomUUID();
  const otherAccountId = randomUUID();
  const createdAt = new Date("2026-01-02T03:04:05.000Z");
  const oldCancellation = new Date(Date.now() - 30_000);
  const attempts = [
    legacyAttempt("pending-targeted", true, false),
    legacyAttempt("pending-untargeted", false, false),
    legacyAttempt("consumed-targeted", true, true),
    legacyAttempt("consumed-untargeted", false, true),
    {
      ...legacyAttempt("consumed-leftover-verifier", false, true),
      verifier: encryptCalendarSecret("synthetic-consumed-leftover"),
    },
    { ...legacyAttempt("cancelled-leftover-verifier", true, false), cancelledAt: oldCancellation },
  ];
  await ctx.pool.query(
    `INSERT INTO calendar_provider_accounts
      (id,user_id,provider_subject,client_id,email_address,refresh_token_enc,scopes,status,version,connected_at,updated_at,last_error_code)
     VALUES ($1,$2,'legacy-subject',$3,'legacy-owner@example.invalid',$4,$5::jsonb,'connected',37,$6,$6,NULL),
            ($7,$2,'legacy-reauth-subject',$3,'legacy-reauth@example.invalid',NULL,$5::jsonb,'reauthRequired',73,$6,$6,'unauthorized')`,
    [
      accountId,
      owner.id,
      calendarTestConfig.clientId,
      encryptCalendarSecret("synthetic-legacy-refresh"),
      JSON.stringify(calendarTestScope.split(" ")),
      createdAt,
      otherAccountId,
    ],
  );
  signal.throwIfAborted();
  for (const attempt of attempts) {
    await ctx.pool.query(
      `INSERT INTO calendar_oauth_attempts
        (state_hash,user_id,browser_binding_hash,code_verifier_enc,client_id,redirect_uri,requested_access,account_id,account_version,expires_at,consumed_at,cancelled_at,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now()+interval '2 minutes',$10,$11,now()-interval '1 minute')`,
      [
        attempt.stateHash,
        owner.id,
        `browser-${attempt.stateHash}`,
        attempt.verifier,
        calendarTestConfig.clientId,
        calendarTestConfig.redirectUri,
        calendarTestConfig.access,
        attempt.targeted ? accountId : null,
        attempt.targeted ? 37 : null,
        attempt.consumed ? new Date() : null,
        attempt.cancelledAt,
      ],
    );
    signal.throwIfAborted();
  }
  return { ownerId: owner.id, accountId, otherAccountId, attempts, oldCancellation };
}
export type LegacyCalendarState = Awaited<ReturnType<typeof seedLegacyCalendarState>>;

export async function legacyAccountEvidence(ctx: TestDb, signal: AbortSignal) {
  signal.throwIfAborted();
  const result = await ctx.pool.query<{ account: Record<string, unknown> }>(
    "SELECT to_jsonb(a)-'connection_generation' AS account FROM calendar_provider_accounts a ORDER BY id",
  );
  signal.throwIfAborted();
  return result.rows;
}

export async function upgradedLegacyAttempts(ctx: TestDb, signal: AbortSignal) {
  signal.throwIfAborted();
  const result = await ctx.pool.query<UpgradedLegacyAttempt>(
    `SELECT state_hash AS "stateHash",account_connection_generation AS pin,
        account_connection_generations AS snapshot,cancelled_at AS "cancelledAt",
        consumed_at AS "consumedAt",code_verifier_enc AS verifier
       FROM calendar_oauth_attempts ORDER BY state_hash`,
  );
  signal.throwIfAborted();
  return result.rows;
}

// Models an already-consumed callback resuming at the current bind seam, not an old binary.
export function resumedLegacyContext(
  state: LegacyCalendarState,
  targeted: boolean,
): ConsumedCalendarAuthorization {
  return {
    stateHash: createHash("sha256")
      .update(`consumed-${targeted ? "targeted" : "untargeted"}`)
      .digest("hex"),
    userId: state.ownerId,
    codeVerifier: "already-decrypted-synthetic-legacy-verifier",
    accountId: targeted ? state.accountId : null,
    accountConnectionGeneration: null,
    accountConnectionGenerations: {},
  };
}
