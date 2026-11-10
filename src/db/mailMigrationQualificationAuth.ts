import { symmetricDecrypt, verifyPassword } from "better-auth/crypto";
import { expect } from "vitest";
import { env } from "@/config/env";
import { createHashedBackupCodeStorage, hashRecoveryInput } from "@/features/auth/better/recoveryCodes";
import { hashSessionCredential } from "@/features/auth/better/sessionToken";
import { loadLiveSessionById } from "@/features/auth/session";
import { QUALIFICATION_PASSWORD, QUALIFICATION_RECOVERY_CODES, QUALIFICATION_TOTP_SECRET, qualificationSessionCredential, type QualificationIds } from "./mailMigrationQualificationFixtures";
import { qualificationHash } from "./mailMigrationQualificationSource";
import { qualificationQuery as query, type QualificationDatabase } from "./mailMigrationQualification.test-helpers";

export async function assertQualificationNativeAuth(database: QualificationDatabase, ids: QualificationIds, signal: AbortSignal): Promise<void> {
  const auth = (await query<{ password: string }>(database.pool,"SELECT password FROM auth_accounts WHERE id=$1",[ids.authAccount],signal)).rows[0];
  expect(auth !== undefined).toBe(true);
  if (auth !== undefined) {
    expect(await verifyPassword({hash:auth.password,password:QUALIFICATION_PASSWORD})).toBe(true);
    signal.throwIfAborted();
    expect(await verifyPassword({hash:auth.password,password:`wrong-${QUALIFICATION_PASSWORD}`})).toBe(false);
    signal.throwIfAborted();
  }
  const factor = (await query<{ secret: string; backup_codes: string; verified: boolean }>(database.pool,"SELECT secret,backup_codes,verified FROM auth_two_factors WHERE id=$1 AND user_id=$2",[ids.twoFactor,ids.owner],signal)).rows[0];
  expect(factor !== undefined).toBe(true);
  if (factor !== undefined) {
    expect(factor.verified).toBe(true);
    const secret = await symmetricDecrypt({key:env.AUTH_SECRET || env.TOKEN_ENCRYPTION_KEY,data:factor.secret});
    signal.throwIfAborted();
    expect(qualificationHash(secret)).toBe(qualificationHash(QUALIFICATION_TOTP_SECRET));
    const recovery = await createHashedBackupCodeStorage().decrypt(factor.backup_codes);
    signal.throwIfAborted();
    expect(qualificationHash(recovery)).toBe(qualificationHash(JSON.stringify(QUALIFICATION_RECOVERY_CODES.map(hashRecoveryInput))));
  }
  for (const [id,assurance,revoked] of [[ids.session,"password",false],[ids.strongSession,"mfa",false],[ids.revokedSession,"mfa",true]] as const) {
    const row = (await query<{ token_hash: string; assurance: string; auth_method: string; revoked: boolean; mfa: boolean; fresh: boolean }>(database.pool,"SELECT token_hash,assurance,auth_method,revoked_at IS NOT NULL AS revoked,mfa_verified_at IS NOT NULL AS mfa,fresh_authenticated_at IS NOT NULL AS fresh FROM sessions WHERE id=$1 AND user_id=$2",[id,ids.owner],signal)).rows[0];
    expect(row !== undefined).toBe(true);
    if (row !== undefined) {
      expect(qualificationHash(row.token_hash)).toBe(qualificationHash(hashSessionCredential(qualificationSessionCredential(id))));
      expect({assurance:row.assurance,method:row.auth_method,revoked:row.revoked,mfa:row.mfa,fresh:row.fresh}).toEqual({assurance,method:"password",revoked,mfa:assurance === "mfa",fresh:true});
    }
  }
  // Internal-ID liveness deliberately avoids touching last_seen_at or accepting a row ID as a cookie.
  expect((await loadLiveSessionById(database.db,ids.strongSession,signal)).ok).toBe(true);
  expect((await loadLiveSessionById(database.db,ids.revokedSession,signal)).ok).toBe(false);
}
