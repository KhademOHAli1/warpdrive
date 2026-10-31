import type { AuthPolicy, InvitationState } from "./domain";

export interface ManagementUser {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
  isActive: boolean;
  invitedAt: string | null;
  permissionSetId: string | null;
  activeSessions: number;
  invitation: {
    id: string;
    state: InvitationState;
    expiresAt: string;
    delivery: string | null;
  } | null;
}
export interface ManagementSnapshot {
  viewerIsAdmin: boolean;
  users: ManagementUser[];
  permissionSets: { id: string; name: string }[];
  assignees: { id: string; name: string }[];
  total: number;
  page: number;
  pageCount: number;
  policy: AuthPolicy;
  deliveries: {
    id: string;
    recipient: string;
    kind: string;
    status: string;
    attempts: number;
    createdAt: string;
    lastErrorCode: string | null;
  }[];
  auditPage: number;
  auditPageCount: number;
  auditTotal: number;
  audit: {
    id: string;
    actorId: string | null;
    actorName: string | null;
    targetUserId: string | null;
    targetName: string | null;
    action: string;
    outcome: string;
    createdAt: string;
  }[];
  requests: {
    id: string;
    userId: string;
    name: string;
    email: string;
    kind: string;
    status: string;
    createdAt: string;
    reason: string | null;
  }[];
  integrationRevocations: {
    id: string;
    userId: string;
    provider: string;
    status: string;
    attempts: number;
    createdAt: string;
  }[];
}
export interface ManagementQuery {
  q: string;
  status: "all" | "active" | "pending" | "inactive";
  page: number;
  auditQ?: string;
  auditOutcome?: "all" | "success" | "denied" | "failure";
  auditPage?: number;
}

export interface ManagedUserDetails {
  userId: string;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  passkeyCount: number;
  providers: string[];
  sessions: {
    id: string;
    createdAt: string;
    lastSeenAt: string;
    expiresAt: string;
    userAgent: string | null;
  }[];
}
