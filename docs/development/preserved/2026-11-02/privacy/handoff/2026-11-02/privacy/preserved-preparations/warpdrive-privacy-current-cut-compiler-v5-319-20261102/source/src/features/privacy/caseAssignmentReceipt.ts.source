import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { privacyCaseEvents, privacyCaseMembers } from "@/db/schema";
import { err, ok } from "@/types/result";
import type { PrivacyActor } from "./authoritySession";

// Called only under current global assignment authority and the case row lock.
export async function readCaseClaimReceipt(
  db: Db,
  actor: PrivacyActor,
  input: { caseId: string; commandId: string; expectedVersion: number },
  signal: AbortSignal,
) {
  const [event] = await db
    .select()
    .from(privacyCaseEvents)
    .where(
      and(
        eq(privacyCaseEvents.caseId, input.caseId),
        eq(privacyCaseEvents.commandId, input.commandId),
      ),
    );
  signal.throwIfAborted();
  if (event === undefined) return null;
  if (
    event.action !== "case.assigned" ||
    event.actorId !== actor.userId ||
    event.caseVersion !== input.expectedVersion + 1
  )
    return err("idempotency_conflict" as const);
  const [member] = await db
    .select()
    .from(privacyCaseMembers)
    .where(
      and(eq(privacyCaseMembers.caseId, input.caseId), eq(privacyCaseMembers.userId, actor.userId)),
    )
    .for("no key update");
  signal.throwIfAborted();
  return member !== undefined &&
    member.revokedAt === null &&
    member.capabilities.includes("case.review") &&
    member.capabilities.includes("authority.manage")
    ? ok({ id: input.caseId, version: event.caseVersion, status: event.toStatus })
    : err("forbidden" as const);
}
