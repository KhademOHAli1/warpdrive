interface AccessInput {
  active: boolean;
  emailVerified: boolean;
  isAdmin: boolean;
  twoFactorEnabled: boolean;
  requireMfaForAll: boolean;
  assurance: string;
  lastSeenAt: Date;
  expiresAt: Date;
  createdAt: Date;
  idleMinutes: number;
  absoluteHours: number;
  now: Date;
}

export type AccessDecision =
  | { allowed: true }
  | { allowed: false; reason: "inactive" | "verification" | "mfa" | "expired" };

export function evaluateSessionAccess(input: AccessInput): AccessDecision {
  if (!input.active) return { allowed: false, reason: "inactive" };
  const now = input.now.getTime();
  if (
    now >= input.expiresAt.getTime() ||
    now - input.lastSeenAt.getTime() >= input.idleMinutes * 60_000 ||
    now - input.createdAt.getTime() >= input.absoluteHours * 3_600_000
  )
    return { allowed: false, reason: "expired" };
  if (!input.emailVerified) return { allowed: false, reason: "verification" };
  const strong = input.assurance === "mfa" || input.assurance === "passkey";
  if (
    input.assurance === "pending" ||
    ((input.isAdmin || input.twoFactorEnabled || input.requireMfaForAll) && !strong)
  ) {
    return { allowed: false, reason: "mfa" };
  }
  return { allowed: true };
}
