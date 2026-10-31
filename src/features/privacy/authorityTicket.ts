import type { PrivacyCapability } from "./capabilities";

export interface PrivacyAuthorityTicket {
  userId: string;
  sessionId: string;
  capability: PrivacyCapability;
  caseId: string | null;
  authorityGeneration: number;
  membershipGeneration: number | null;
  scopeVersion: number | null;
  policyVersion: number | null;
  activePolicyVersion: number | null;
  policyGeneration: number;
  recipientVersion: number | null;
  verificationVersion: number | null;
}

export function samePrivacyTicket(a: PrivacyAuthorityTicket, b: PrivacyAuthorityTicket): boolean {
  return (
    a.userId === b.userId &&
    a.sessionId === b.sessionId &&
    a.capability === b.capability &&
    a.caseId === b.caseId &&
    a.authorityGeneration === b.authorityGeneration &&
    a.membershipGeneration === b.membershipGeneration &&
    a.scopeVersion === b.scopeVersion &&
    a.policyVersion === b.policyVersion &&
    a.activePolicyVersion === b.activePolicyVersion &&
    a.policyGeneration === b.policyGeneration &&
    a.recipientVersion === b.recipientVersion &&
    a.verificationVersion === b.verificationVersion
  );
}
