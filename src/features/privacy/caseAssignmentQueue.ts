import { and, asc, gt, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { privacyCases } from "@/db/schema";
import { err, ok } from "@/types/result";
import { unassignedIntakeCondition } from "./caseAssignmentEligibility";
import { privacyStorageOperation } from "./casePersistence";
import { type PrivacyActor, withPrivacyAuthority } from "./permissions";

const queueSchema = z.strictObject({
  limit: z.number().int().min(1).max(100),
  afterId: z.uuid().optional(),
});

export async function listPrivacyIntakeQueue(
  db: Db,
  actor: PrivacyActor,
  raw: unknown,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const parsed = queueSchema.safeParse(raw);
  if (!parsed.success) return err("invalid_input" as const);
  const input = parsed.data;
  return privacyStorageOperation(signal, () =>
    withPrivacyAuthority(db, actor, { capability: "case.assign" }, signal, async (tx) => {
      const items = await tx
        .select({
          id: privacyCases.id,
          kind: privacyCases.kind,
          status: privacyCases.status,
          version: privacyCases.version,
          receivedAt: privacyCases.receivedAt,
          dueAt: privacyCases.dueAt,
        })
        .from(privacyCases)
        .where(
          and(
            inArray(privacyCases.status, ["received", "verification_needed"]),
            unassignedIntakeCondition(tx),
            input.afterId === undefined ? undefined : gt(privacyCases.id, input.afterId),
          ),
        )
        .orderBy(asc(privacyCases.id))
        .limit(input.limit);
      signal.throwIfAborted();
      return ok({
        items,
        nextAfterId: items.length === input.limit ? (items.at(-1)?.id ?? null) : null,
        snapshot: "live_unassigned" as const,
      });
    }),
  );
}
