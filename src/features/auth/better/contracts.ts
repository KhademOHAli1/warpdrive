export interface AuthProvider {
  id: string;
  name: string;
}

export interface AuthProviders {
  providers: AuthProvider[];
  emailPassword: boolean;
  passkeys: boolean;
}

export interface AuthPolicy {
  requireMfaForAll: boolean;
  idleMinutes: number;
  absoluteHours: number;
  freshMinutes: number;
}

export interface SecurityStatus {
  authenticated: true;
  user: { id: string; name: string; email: string; isAdmin: boolean };
  emailVerified: boolean;
  hasPassword: boolean;
  twoFactorEnabled: boolean;
  needsMfa: boolean;
  needsEnrollment: boolean;
  fresh: boolean;
  authMethod: string;
  policy: AuthPolicy;
  accounts: { id: string; providerId: string; accountId: string }[];
  passkeys: {
    id: string;
    name: string | null;
    createdAt: string;
    deviceType: string;
    backedUp: boolean;
  }[];
  sessions: {
    id: string;
    current: boolean;
    createdAt: string;
    lastSeenAt: string;
    expiresAt: string;
    ipAddress: string | null;
    userAgent: string | null;
  }[];
  recoveryCodesAvailable: boolean;
  audit: { id: string; action: string; outcome: string; createdAt: string }[];
}

export type SecurityAction =
  | { action: "reauthenticate"; password: string }
  | { action: "revokeSession"; id: string }
  | { action: "revokeOthers" }
  | { action: "revokeAll" }
  | { action: "unlinkAccount"; providerId: string; accountId: string }
  | { action: "requestClosure"; reason: string };

export type WorkflowResponse<T> = { ok: true; data: T } | { ok: false; error: string };
