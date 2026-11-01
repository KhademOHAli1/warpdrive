import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { privacyJobs } from "@/db/schema";
import { err, ok } from "@/types/result";
import { privacyStorageOperation } from "./casePersistence";
import { type PrivacyActor, withPrivacyAuthority } from "./permissions";

const statusInputSchema = z.strictObject({ caseId: z.uuid(), jobId: z.uuid() });
const statusSchema = z.strictObject({
  id: z.uuid(),
  caseId: z.uuid(),
  kind: z.literal("discovery"),
  status: z.enum(["queued", "running", "needs_attention", "succeeded", "failed", "cancelled"]),
  attempts: z.number().int().nonnegative(),
  updatedAt: z.date(),
});

// Current reviewer authority permits observation only; this does not reauthorize the worker.
// Enqueue receipts remain historical, and reads never repair a lease or retry a job.
export async function getDiscoveryJobStatus(
  db: Db,
  actor: PrivacyActor,
  input: unknown,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const parsed = statusInputSchema.safeParse(input);
  if (!parsed.success) return err("invalid_input" as const);
  return privacyStorageOperation(signal, () =>
    withPrivacyAuthority(
      db,
      actor,
      { capability: "case.review", caseId: parsed.data.caseId },
      signal,
      async (tx) => {
        const [row] = await tx
          .select({
            id: privacyJobs.id,
            caseId: privacyJobs.caseId,
            kind: privacyJobs.kind,
            status: privacyJobs.status,
            attempts: privacyJobs.attempts,
            updatedAt: privacyJobs.updatedAt,
          })
          .from(privacyJobs)
          .where(
            and(
              eq(privacyJobs.id, parsed.data.jobId),
              eq(privacyJobs.caseId, parsed.data.caseId),
              eq(privacyJobs.kind, "discovery"),
            ),
          );
        signal.throwIfAborted();
        if (row === undefined) return err("not_found" as const);
        const status = statusSchema.safeParse(row);
        return status.success ? ok(status.data) : err("storage_unavailable" as const);
      },
    ),
  );
}
