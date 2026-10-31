import type { AuthPolicy } from "./contracts";

export function isFreshAuthentication(
  session: { assurance: string; freshAuthenticatedAt: Date | null; mfaVerifiedAt: Date | null },
  strongRequired: boolean,
  policy: AuthPolicy,
  now = Date.now(),
): boolean {
  if (
    session.freshAuthenticatedAt === null ||
    now - session.freshAuthenticatedAt.getTime() >= policy.freshMinutes * 60_000
  )
    return false;
  if (!strongRequired) return true;
  if (session.assurance === "passkey") return true;
  return (
    session.assurance === "mfa" &&
    session.mfaVerifiedAt !== null &&
    now - session.mfaVerifiedAt.getTime() < policy.freshMinutes * 60_000
  );
}
