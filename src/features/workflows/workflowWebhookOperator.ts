import { z } from "zod";
import { env } from "@/config/env";
import { workflowRuns } from "@/db/schema";
import type { WorkflowWebhookAdmissionServices } from "./workflowWebhookAdmission";

const operatorKeys = z
  .array(
    z.strictObject({
      workflowId: z.uuid().toLowerCase(),
      ownerId: z.uuid().toLowerCase(),
      signingKey: z
        .string()
        .regex(/^[A-Za-z0-9_-]{43}$/u)
        .refine((value) => {
          const decoded = Buffer.from(value, "base64url");
          return decoded.length === 32 && decoded.toString("base64url") === value;
        }),
    }),
  )
  .max(100)
  .refine(
    (entries) => new Set(entries.map(({ workflowId }) => workflowId)).size === entries.length,
  );

function readOperatorKeys(raw: unknown) {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 16_384) return [];
  try {
    const payload: unknown = JSON.parse(raw);
    const checked = operatorKeys.safeParse(payload);
    return checked.success ? checked.data : [];
  } catch {
    return [];
  }
}

export function hasWorkflowWebhookKey(workflowId: string, ownerId: string): boolean {
  return readOperatorKeys(env.WORKFLOW_WEBHOOK_KEYS).some(
    (entry) => entry.workflowId === workflowId && entry.ownerId === ownerId,
  );
}

export const workflowWebhookOperatorServices: WorkflowWebhookAdmissionServices = {
  readSigningKey: (_db, workflowId, signal) => {
    signal.throwIfAborted();
    const entry = readOperatorKeys(env.WORKFLOW_WEBHOOK_KEYS).find(
      (item) => item.workflowId === workflowId,
    );
    return Promise.resolve(
      entry === undefined ? null : { ownerId: entry.ownerId, signingKey: entry.signingKey },
    );
  },
  async insertRun(tx, row) {
    const [inserted] = await tx.insert(workflowRuns).values(row).returning({ id: workflowRuns.id });
    return inserted;
  },
};
