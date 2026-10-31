import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { privacyCaseEvents, privacyCases, privacyDeadlineDecisions } from "@/db/schema";
import { err, ok, type Result } from "@/types/result";
import { decryptPrivacy, encryptPrivacy, fingerprintPrivacy } from "./crypto";
import { deadlinePolicySchema, extensionSchema, type PrivacyDeadline } from "./deadlines";

export const privacyDeadlineSnapshotSchema = z.object({
  receivedAt: z.iso.datetime(),
  originalDueAt: z.iso.datetime(),
  dueAt: z.iso.datetime(),
  policy: deadlinePolicySchema,
  extensionMonths: z.number().int().nonnegative(),
  extensions: z.array(extensionSchema),
});
export const deadlineCommandResultSchema = z.object({
  deadline: privacyDeadlineSnapshotSchema,
  caseVersion: z.number().int().positive(),
  recordVersion: z.number().int().positive(),
});
export interface DeadlineRecordResult {
  deadline: PrivacyDeadline;
  caseVersion: number;
  recordVersion: number;
}
export const deadlineCommandDigest = (input: { caseId: string }) =>
  fingerprintPrivacy(JSON.stringify(input), {
    caseId: `${input.caseId}:deadline`,
    purpose: "decision",
  });

export function decodeDeadlineSnapshot(value: Buffer, caseId: string) {
  const decrypted = decryptPrivacy(value, { caseId, purpose: "decision" });
  if (!decrypted.ok) return err("deadline_unreadable" as const);
  try {
    const parsed = privacyDeadlineSnapshotSchema.safeParse(JSON.parse(decrypted.value));
    return parsed.success ? ok(parsed.data) : err("deadline_unreadable" as const);
  } catch {
    return err("deadline_unreadable" as const);
  }
}

export async function replayDeadlineCommand(
  db: Db,
  caseId: string,
  commandId: string,
  inputDigest: string,
  signal: AbortSignal,
): Promise<Result<DeadlineRecordResult | null, "command_conflict" | "deadline_unreadable">> {
  const [existing] = await db
    .select()
    .from(privacyDeadlineDecisions)
    .where(
      and(
        eq(privacyDeadlineDecisions.caseId, caseId),
        eq(privacyDeadlineDecisions.commandId, commandId),
      ),
    );
  signal.throwIfAborted();
  if (existing === undefined) return ok(null);
  if (existing.inputDigest !== inputDigest) return err("command_conflict");
  const decrypted = decryptPrivacy(existing.resultEnc, {
    caseId: `${caseId}:deadline:${commandId}`,
    purpose: "decision",
  });
  if (!decrypted.ok) return err("deadline_unreadable");
  try {
    const parsed = deadlineCommandResultSchema.safeParse(JSON.parse(decrypted.value));
    return parsed.success ? ok(parsed.data) : err("deadline_unreadable");
  } catch {
    return err("deadline_unreadable");
  }
}

export async function recordDeadlineCommand(
  db: Db,
  args: {
    caseId: string;
    commandId: string;
    inputDigest: string;
    actorId: string;
    action: "deadline_bound" | "deadline_extended";
    status: string;
    result: DeadlineRecordResult;
  },
  signal: AbortSignal,
): Promise<void> {
  const { caseId, commandId, result } = args;
  await db
    .update(privacyCases)
    .set({
      dueAt: new Date(result.deadline.dueAt),
      policyVersion: args.action === "deadline_bound" ? result.deadline.policy.version : undefined,
      version: result.caseVersion,
      updatedAt: new Date(),
    })
    .where(eq(privacyCases.id, caseId));
  await db.insert(privacyDeadlineDecisions).values({
    caseId,
    commandId,
    inputDigest: args.inputDigest,
    createdBy: args.actorId,
    resultEnc: encryptPrivacy(JSON.stringify(result), {
      caseId: `${caseId}:deadline:${commandId}`,
      purpose: "decision",
    }),
  });
  await db.insert(privacyCaseEvents).values({
    caseId,
    caseVersion: result.caseVersion,
    commandId,
    actorId: args.actorId,
    action: args.action,
    fromStatus: args.status,
    toStatus: args.status,
  });
  signal.throwIfAborted();
}
