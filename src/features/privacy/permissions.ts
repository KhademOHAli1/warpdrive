import { and, eq, TransactionRollbackError } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  privacyAuthority,
  privacyCaseMembers,
  privacyCases,
  privacyPolicyState,
} from "@/db/schema";
import { lockAuthAccount } from "@/features/auth/better/accountLock";
import { lockMcpGrants } from "@/features/auth/management/mcpGrants";
import { err, type Result } from "@/types/result";
import { currentPrivacySession, type PrivacyActor } from "./authoritySession";
import { type PrivacyAuthorityTicket, samePrivacyTicket } from "./authorityTicket";
import type { PrivacyCapability } from "./capabilities";
import { currentCaseIdentityBinding } from "./identityBinding";

export type { PrivacyActor } from "./authoritySession";
export type { PrivacyAuthorityTicket } from "./authorityTicket";

export interface PrivacyAuthorityRequest {
  capability: PrivacyCapability;
  caseId?: string;
  requireVerifiedSubject?: boolean;
  expected?: PrivacyAuthorityTicket;
}

const VERIFIED_CAPABILITIES = new Set<PrivacyCapability>([
  "case.disclose",
  "case.export",
  "case.restrict",
  "case.erase.approve",
  "case.erase.execute",
]);

async function caseTicket(
  db: Db,
  actor: PrivacyActor,
  request: PrivacyAuthorityRequest,
  generation: number,
  signal: AbortSignal,
): Promise<PrivacyAuthorityTicket | null> {
  const [activePolicy] = await db
    .select({ version: privacyPolicyState.version, generation: privacyPolicyState.generation })
    .from(privacyPolicyState)
    .where(eq(privacyPolicyState.id, true))
    .limit(1);
  signal.throwIfAborted();
  const ticket: PrivacyAuthorityTicket = {
    ...actor,
    capability: request.capability,
    caseId: request.caseId ?? null,
    authorityGeneration: generation,
    membershipGeneration: null,
    scopeVersion: null,
    policyVersion: null,
    activePolicyVersion: activePolicy?.version ?? null,
    policyGeneration: activePolicy?.generation ?? 0,
    recipientVersion: null,
    verificationVersion: null,
  };
  if (request.caseId === undefined)
    return request.capability.startsWith("case.") &&
      request.capability !== "case.intake" &&
      request.capability !== "case.assign"
      ? null
      : ticket;
  const [privacyCase] = await db
    .select()
    .from(privacyCases)
    .where(eq(privacyCases.id, request.caseId))
    .for("no key update");
  signal.throwIfAborted();
  if (
    privacyCase === undefined ||
    ((VERIFIED_CAPABILITIES.has(request.capability) || request.requireVerifiedSubject === true) &&
      !(await currentCaseIdentityBinding(db, privacyCase, signal)))
  )
    return null;
  const [member] = await db
    .select()
    .from(privacyCaseMembers)
    .where(
      and(
        eq(privacyCaseMembers.caseId, privacyCase.id),
        eq(privacyCaseMembers.userId, actor.userId),
      ),
    )
    .for("no key update");
  signal.throwIfAborted();
  if (
    member === undefined ||
    member.revokedAt !== null ||
    !member.capabilities.includes(request.capability)
  )
    return null;
  return {
    ...ticket,
    membershipGeneration: member.generation,
    scopeVersion: privacyCase.scopeVersion,
    policyVersion: privacyCase.policyVersion,
    recipientVersion: privacyCase.recipientVersion,
    verificationVersion: privacyCase.verificationVersion,
  };
}

// Hold authority checks through the local commit. Remote effects need a durable, separately fenced intent.
export async function withPrivacyAuthority<R extends Result<unknown, unknown>>(
  db: Db,
  actor: PrivacyActor,
  request: PrivacyAuthorityRequest,
  signal: AbortSignal,
  effect: (tx: Db, ticket: PrivacyAuthorityTicket) => Promise<R>,
): Promise<R | { ok: false; error: "forbidden" }> {
  signal.throwIfAborted();
  let failedResult: R | undefined;
  try {
    return await db.transaction(async (tx) => {
      await lockAuthAccount(tx, actor.userId, signal);
      await lockMcpGrants(tx, signal);
      if (!(await currentPrivacySession(tx, actor, signal))) return err("forbidden" as const);
      const [authority] = await tx
        .select()
        .from(privacyAuthority)
        .where(eq(privacyAuthority.userId, actor.userId))
        .for("no key update");
      signal.throwIfAborted();
      if (authority === undefined || !authority.capabilities.includes(request.capability))
        return err("forbidden" as const);
      const ticket = await caseTicket(tx, actor, request, authority.generation, signal);
      if (
        ticket === null ||
        (request.expected !== undefined && !samePrivacyTicket(ticket, request.expected))
      )
        return err("forbidden" as const);
      const result = await effect(tx, ticket);
      signal.throwIfAborted();
      if (!result.ok) {
        failedResult = result;
        tx.rollback();
      }
      return result;
    });
  } catch (error) {
    if (failedResult !== undefined && error instanceof TransactionRollbackError)
      return failedResult;
    throw error;
  }
}
