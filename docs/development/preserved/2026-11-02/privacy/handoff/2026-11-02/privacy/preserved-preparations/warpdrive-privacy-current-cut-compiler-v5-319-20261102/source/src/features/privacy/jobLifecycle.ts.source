import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { privacyCases, privacyJobs } from "@/db/schema";
import { err, ok } from "@/types/result";
import { privacyStorageOperation } from "./casePersistence";
import { decryptPrivacy, encryptPrivacy } from "./crypto";
import { type PrivacyAuthorityTicket, withPrivacyAuthority } from "./permissions";

const LEASE_MS = 60_000;
const MAX_ATTEMPTS = 5;
const receiptSchema = z
  .object({ recordCount: z.number().int().min(0), reviewRequired: z.literal(true) })
  .strict();
type Job = typeof privacyJobs.$inferSelect;
function expectedTicket(job: Job): PrivacyAuthorityTicket {
  return {
    userId: job.requestedBy,
    sessionId: job.originatingSessionId,
    capability: "case.review",
    caseId: job.caseId,
    authorityGeneration: job.authorityGeneration,
    membershipGeneration: job.memberGeneration,
    scopeVersion: job.scopeVersion,
    policyVersion: job.policyVersion,
    activePolicyVersion: job.activePolicyVersion,
    policyGeneration: job.policyGeneration,
    recipientVersion: job.recipientVersion,
    verificationVersion: job.verificationVersion,
  };
}
async function loadJob(db: Db, id: string, signal: AbortSignal) {
  const [job] = await db
    .select()
    .from(privacyJobs)
    .where(and(eq(privacyJobs.id, id), eq(privacyJobs.kind, "discovery")));
  signal.throwIfAborted();
  return job;
}
async function discoveryAllowed(db: Db, caseId: string, signal: AbortSignal) {
  const [row] = await db
    .select({ status: privacyCases.status })
    .from(privacyCases)
    .where(eq(privacyCases.id, caseId));
  signal.throwIfAborted();
  return row?.status === "under_review";
}
async function recordAttention(
  db: Db,
  id: string,
  reason: "authority_changed" | "attempts_exhausted" | "case_not_reviewable",
  signal: AbortSignal,
) {
  await db
    .update(privacyJobs)
    .set({ status: "needs_attention", lastErrorCode: reason, updatedAt: new Date() })
    .where(and(eq(privacyJobs.id, id), inArray(privacyJobs.status, ["queued", "running"])));
  signal.throwIfAborted();
}

export async function claimDiscoveryJob(db: Db, id: string, signal: AbortSignal) {
  return privacyStorageOperation(signal, async () => {
    const job = await loadJob(db, id, signal);
    if (job === undefined) return err("not_found" as const);
    const ticket = expectedTicket(job);
    const result = await withPrivacyAuthority(
      db,
      { userId: job.requestedBy, sessionId: job.originatingSessionId },
      {
        capability: "case.review",
        caseId: job.caseId,
        requireVerifiedSubject: true,
        expected: ticket,
      },
      signal,
      async (tx) => {
        if (!(await discoveryAllowed(tx, job.caseId, signal)))
          return err("case_not_reviewable" as const);
        const [current] = await tx
          .select()
          .from(privacyJobs)
          .where(eq(privacyJobs.id, id))
          .for("no key update");
        signal.throwIfAborted();
        const now = new Date();
        if (
          current === undefined ||
          (current.status !== "queued" &&
            !(
              current.status === "running" &&
              current.leaseUntil !== null &&
              current.leaseUntil <= now
            ))
        )
          return err("not_claimable" as const);
        if (current.attempts >= MAX_ATTEMPTS) return err("attempts_exhausted" as const);
        const claimToken = randomUUID();
        const leaseUntil = new Date(now.getTime() + LEASE_MS);
        await tx
          .update(privacyJobs)
          .set({
            status: "running",
            claimToken,
            leaseUntil,
            attempts: current.attempts + 1,
            updatedAt: now,
          })
          .where(eq(privacyJobs.id, id));
        signal.throwIfAborted();
        return ok({ id, claimToken, leaseUntil });
      },
    );
    if (
      !result.ok &&
      (result.error === "forbidden" ||
        result.error === "attempts_exhausted" ||
        result.error === "case_not_reviewable")
    )
      await recordAttention(
        db,
        id,
        result.error === "forbidden" ? "authority_changed" : result.error,
        signal,
      );
    return result;
  });
}

export async function completeDiscoveryJob(
  db: Db,
  id: string,
  claimToken: string,
  receipt: unknown,
  signal: AbortSignal,
) {
  const parsed = receiptSchema.safeParse(receipt);
  if (!parsed.success) return err("invalid_input" as const);
  const body = JSON.stringify(parsed.data);
  return privacyStorageOperation(signal, async () => {
    const job = await loadJob(db, id, signal);
    if (job === undefined) return err("not_found" as const);
    const result = await withPrivacyAuthority(
      db,
      { userId: job.requestedBy, sessionId: job.originatingSessionId },
      {
        capability: "case.review",
        caseId: job.caseId,
        requireVerifiedSubject: true,
        expected: expectedTicket(job),
      },
      signal,
      async (tx) => {
        if (!(await discoveryAllowed(tx, job.caseId, signal)))
          return err("case_not_reviewable" as const);
        const [current] = await tx
          .select()
          .from(privacyJobs)
          .where(eq(privacyJobs.id, id))
          .for("no key update");
        signal.throwIfAborted();
        if (current === undefined || current.claimToken !== claimToken)
          return err("lease_lost" as const);
        if (current.status === "succeeded" && current.resultEnc !== null) {
          const prior = decryptPrivacy(current.resultEnc, {
            caseId: current.caseId,
            purpose: "job",
          });
          return prior.ok && prior.value === body
            ? ok({ id, status: "succeeded" as const })
            : err("idempotency_conflict" as const);
        }
        if (
          current.status !== "running" ||
          current.leaseUntil === null ||
          current.leaseUntil <= new Date()
        )
          return err("lease_lost" as const);
        await tx
          .update(privacyJobs)
          .set({
            status: "succeeded",
            resultEnc: encryptPrivacy(body, { caseId: current.caseId, purpose: "job" }),
            leaseUntil: null,
            updatedAt: new Date(),
          })
          .where(eq(privacyJobs.id, id));
        signal.throwIfAborted();
        return ok({ id, status: "succeeded" as const });
      },
    );
    if (!result.ok && (result.error === "forbidden" || result.error === "case_not_reviewable"))
      await recordAttention(
        db,
        id,
        result.error === "forbidden" ? "authority_changed" : result.error,
        signal,
      );
    return result;
  });
}
