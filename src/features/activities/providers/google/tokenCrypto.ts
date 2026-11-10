import { decryptToken, encryptToken } from "@/features/email/crypto";
import { err, ok, type Result } from "@/types/result";
import type { CalendarAuthorizationError } from "./authorizationConfig";
export const encryptCalendarSecret = encryptToken;
export function decryptCalendarSecret(value: Buffer): Result<string, CalendarAuthorizationError> {
  const decrypted = decryptToken(value);
  return decrypted.ok ? ok(decrypted.value) : err({ kind: "credential_corrupt" });
}
