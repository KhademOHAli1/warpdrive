import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  privacyPolicyDrafts,
  privacyPolicyState,
  privacyPolicyVersions,
} from "@/db/schema/privacyPolicies";
import { err, ok } from "@/types/result";
import { privacyStorageOperation } from "./casePersistence";
import { encryptPrivacy } from "./crypto";
import { type PrivacyActor, withPrivacyAuthority } from "./permissions";
import {
  activatePrivacyPolicySchema,
  privacyPolicyComplete,
  savePrivacyPolicyDraftSchema,
} from "./policySchemas";
import { decodePolicyProfile, readPrivacyPolicyRevision } from "./policyStorage";

export async function savePrivacyPolicyDraft(
  db: Db,
  actor: PrivacyActor,
  input: unknown,
  signal: AbortSignal,
) {
  return privacyStorageOperation(signal, () =>
    withPrivacyAuthority(db, actor, { capability: "policy.manage" }, signal, async (tx) => {
      const parsed = savePrivacyPolicyDraftSchema.safeParse(input);
      if (!parsed.success) return err("policy_invalid" as const);
      const id = parsed.data.id ?? randomUUID();
      const contentEnc = encryptPrivacy(JSON.stringify(parsed.data.profile), {
        caseId: `policy-draft:${id}`,
        purpose: "policy",
      });
      if (parsed.data.expectedRevision === undefined) {
        await tx
          .insert(privacyPolicyDrafts)
          .values({ id, contentEnc, createdBy: actor.userId, updatedBy: actor.userId });
        signal.throwIfAborted();
        return ok({ id, revision: 1 });
      }
      const [updated] = await tx
        .update(privacyPolicyDrafts)
        .set({
          contentEnc,
          revision: parsed.data.expectedRevision + 1,
          updatedBy: actor.userId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(privacyPolicyDrafts.id, id),
            eq(privacyPolicyDrafts.revision, parsed.data.expectedRevision),
          ),
        )
        .returning({ id: privacyPolicyDrafts.id, revision: privacyPolicyDrafts.revision });
      signal.throwIfAborted();
      return updated === undefined ? err("policy_conflict" as const) : ok(updated);
    }),
  );
}

export async function activatePrivacyPolicy(
  db: Db,
  actor: PrivacyActor,
  input: unknown,
  signal: AbortSignal,
) {
  return privacyStorageOperation(signal, () =>
    withPrivacyAuthority(db, actor, { capability: "policy.manage" }, signal, async (tx) => {
      const parsed = activatePrivacyPolicySchema.safeParse(input);
      if (!parsed.success) return err("policy_invalid" as const);
      const request = parsed.data;
      const [draft] = await tx
        .select()
        .from(privacyPolicyDrafts)
        .where(eq(privacyPolicyDrafts.id, request.draftId))
        .for("no key update");
      signal.throwIfAborted();
      if (draft === undefined || draft.revision !== request.expectedDraftRevision)
        return err("policy_conflict" as const);
      const decoded = decodePolicyProfile(draft.contentEnc, `policy-draft:${draft.id}`);
      if (!decoded.ok) return decoded;
      if (!privacyPolicyComplete(decoded.value)) return err("policy_incomplete" as const);
      const [current] = await tx
        .select()
        .from(privacyPolicyState)
        .where(eq(privacyPolicyState.id, true))
        .for("no key update");
      signal.throwIfAborted();
      if ((current?.version ?? null) !== request.expectedActiveVersion)
        return err("policy_conflict" as const);
      const [alreadyActivated] = await tx
        .select({ version: privacyPolicyVersions.version })
        .from(privacyPolicyVersions)
        .where(
          and(
            eq(privacyPolicyVersions.draftId, draft.id),
            eq(privacyPolicyVersions.draftRevision, draft.revision),
          ),
        );
      signal.throwIfAborted();
      if (alreadyActivated !== undefined) return err("policy_conflict" as const);
      const version = (current?.version ?? 0) + 1;
      const activatedAt = new Date();
      await tx.insert(privacyPolicyVersions).values({
        version,
        draftId: draft.id,
        draftRevision: draft.revision,
        activatedBy: actor.userId,
        activatedAt,
        profileEnc: encryptPrivacy(JSON.stringify(decoded.value), {
          caseId: `policy:${version}:profile`,
          purpose: "policy",
        }),
        reviewEnc: encryptPrivacy(
          JSON.stringify({ reviewReference: request.reviewReference, reason: request.reason }),
          { caseId: `policy:${version}:review`, purpose: "policy" },
        ),
      });
      await tx
        .insert(privacyPolicyState)
        .values({
          id: true,
          version,
          generation: (current?.generation ?? 0) + 1,
          updatedBy: actor.userId,
          updatedAt: activatedAt,
        })
        .onConflictDoUpdate({
          target: privacyPolicyState.id,
          set: {
            version,
            generation: (current?.generation ?? 0) + 1,
            updatedBy: actor.userId,
            updatedAt: activatedAt,
          },
        });
      signal.throwIfAborted();
      return ok({
        version,
        profile: decoded.value,
        activatedAt: activatedAt.toISOString(),
        activatedBy: actor.userId,
      });
    }),
  );
}

export async function readActivePrivacyPolicy(db: Db, actor: PrivacyActor, signal: AbortSignal) {
  return privacyStorageOperation(signal, () =>
    withPrivacyAuthority(db, actor, { capability: "policy.manage" }, signal, async (tx) => {
      const [current] = await tx
        .select()
        .from(privacyPolicyState)
        .where(eq(privacyPolicyState.id, true));
      signal.throwIfAborted();
      return current?.version == null
        ? ok(null)
        : readPrivacyPolicyRevision(tx, current.version, signal);
    }),
  );
}
