import { Temporal } from "@js-temporal/polyfill";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { privacyCases, privacyDeadlineRecords, privacyPolicyState } from "@/db/schema";
import { err, ok } from "@/types/result";
import { privacyStorageOperation } from "./casePersistence";
import { encryptPrivacy } from "./crypto";
import {
  deadlineCommandDigest,
  decodeDeadlineSnapshot,
  recordDeadlineCommand,
  replayDeadlineCommand,
} from "./deadlineRecordsStorage";
import { createPrivacyDeadline, extendPrivacyDeadline, extensionSchema } from "./deadlines";
import { type PrivacyActor, withPrivacyAuthority } from "./permissions";
import { readPrivacyPolicyRevision } from "./policyStorage";

const commandSchema = z.object({
  caseId: z.uuid(),
  expectedCaseVersion: z.number().int().positive(),
  commandId: z.string().min(1).max(200),
});
const bindSchema = commandSchema.extend({ policyVersion: z.number().int().positive() });
const extendSchema = commandSchema.extend({
  expectedDeadlineVersion: z.number().int().positive(),
  extension: extensionSchema,
});

export async function bindPrivacyDeadline(
  db: Db,
  actor: PrivacyActor,
  input: unknown,
  signal: AbortSignal,
) {
  const parsed = bindSchema.safeParse(input);
  if (!parsed.success) return err("deadline_invalid" as const);
  const request = parsed.data;
  return privacyStorageOperation(signal, () =>
    withPrivacyAuthority(
      db,
      actor,
      { capability: "case.review", caseId: request.caseId },
      signal,
      async (tx) => {
        const inputDigest = deadlineCommandDigest(request);
        const replay = await replayDeadlineCommand(
          tx,
          request.caseId,
          request.commandId,
          inputDigest,
          signal,
        );
        if (!replay.ok || replay.value !== null) return replay;
        const [privacyCase] = await tx
          .select()
          .from(privacyCases)
          .where(eq(privacyCases.id, request.caseId));
        signal.throwIfAborted();
        if (privacyCase === undefined || privacyCase.version !== request.expectedCaseVersion)
          return err("case_conflict" as const);
        const [current] = await tx
          .select()
          .from(privacyPolicyState)
          .where(eq(privacyPolicyState.id, true));
        signal.throwIfAborted();
        if (current?.version !== request.policyVersion) return err("policy_conflict" as const);
        const policy = await readPrivacyPolicyRevision(tx, request.policyVersion, signal);
        if (!policy.ok) return policy;
        const calculated = createPrivacyDeadline(privacyCase.receivedAt.toISOString(), {
          id: `policy:${policy.value.version}`,
          version: policy.value.version,
          activated: true,
          calendar: "gregory",
          ...policy.value.profile.deadline,
        });
        if (!calculated.ok) return calculated;
        const [existing] = await tx
          .select({ caseId: privacyDeadlineRecords.caseId })
          .from(privacyDeadlineRecords)
          .where(eq(privacyDeadlineRecords.caseId, request.caseId));
        signal.throwIfAborted();
        if (existing !== undefined) return err("deadline_exists" as const);
        const result = {
          deadline: calculated.value,
          recordVersion: 1,
          caseVersion: privacyCase.version + 1,
        };
        await tx.insert(privacyDeadlineRecords).values({
          caseId: request.caseId,
          policyVersion: request.policyVersion,
          receivedAt: privacyCase.receivedAt,
          originalDueAt: new Date(calculated.value.originalDueAt),
          dueAt: new Date(calculated.value.dueAt),
          snapshotEnc: encryptPrivacy(JSON.stringify(calculated.value), {
            caseId: request.caseId,
            purpose: "decision",
          }),
        });
        await recordDeadlineCommand(
          tx,
          {
            ...request,
            inputDigest,
            actorId: actor.userId,
            action: "deadline_bound",
            status: privacyCase.status,
            result,
          },
          signal,
        );
        return ok(result);
      },
    ),
  );
}

export async function extendPrivacyDeadlineRecord(
  db: Db,
  actor: PrivacyActor,
  input: unknown,
  signal: AbortSignal,
) {
  const parsed = extendSchema.safeParse(input);
  if (!parsed.success) return err("deadline_invalid" as const);
  const request = parsed.data;
  return privacyStorageOperation(signal, () =>
    withPrivacyAuthority(
      db,
      actor,
      { capability: "case.review", caseId: request.caseId },
      signal,
      async (tx) => {
        const inputDigest = deadlineCommandDigest(request);
        const replay = await replayDeadlineCommand(
          tx,
          request.caseId,
          request.commandId,
          inputDigest,
          signal,
        );
        if (!replay.ok || replay.value !== null) return replay;
        const [privacyCase] = await tx
          .select()
          .from(privacyCases)
          .where(eq(privacyCases.id, request.caseId));
        signal.throwIfAborted();
        if (privacyCase === undefined || privacyCase.version !== request.expectedCaseVersion)
          return err("case_conflict" as const);
        const [record] = await tx
          .select()
          .from(privacyDeadlineRecords)
          .where(eq(privacyDeadlineRecords.caseId, request.caseId))
          .for("no key update");
        signal.throwIfAborted();
        if (record === undefined || record.version !== request.expectedDeadlineVersion)
          return err("deadline_conflict" as const);
        const snapshot = decodeDeadlineSnapshot(record.snapshotEnc, request.caseId);
        if (!snapshot.ok) return snapshot;
        const extended = extendPrivacyDeadline(snapshot.value, request.extension);
        if (!extended.ok) return extended;
        const notice = extended.value.extensions.find(
          (entry) => entry.noticeReference === request.extension.noticeReference,
        );
        if (
          notice === undefined ||
          Temporal.Instant.compare(notice.noticeRecordedAt, Temporal.Now.instant()) > 0
        )
          return err("notice_invalid" as const);
        const result = {
          deadline: extended.value,
          recordVersion: record.version + 1,
          caseVersion: privacyCase.version + 1,
        };
        await tx
          .update(privacyDeadlineRecords)
          .set({
            dueAt: new Date(extended.value.dueAt),
            snapshotEnc: encryptPrivacy(JSON.stringify(extended.value), {
              caseId: request.caseId,
              purpose: "decision",
            }),
            extensionMonths: extended.value.extensionMonths,
            version: result.recordVersion,
            updatedAt: new Date(),
          })
          .where(eq(privacyDeadlineRecords.caseId, request.caseId));
        await recordDeadlineCommand(
          tx,
          {
            ...request,
            inputDigest,
            actorId: actor.userId,
            action: "deadline_extended",
            status: privacyCase.status,
            result,
          },
          signal,
        );
        return ok(result);
      },
    ),
  );
}
