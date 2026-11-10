import { z } from "zod";
import type { MappingTarget } from "./mappingTypes";
import { bindingSchema } from "./schemas";
import {
  type WorkflowRecordEventData,
  workflowRecordEventOutput,
  workflowRecordEventWatchFields,
} from "./workflowRecordEventContract";

export const workflowEventWaitMaxMinutes = 43_200;
export const workflowEventWaitKinds = ["updated", "deleted", "upserted"] as const;
const dealId = z.uuid().toLowerCase();

// The safe Deal-only slice waits on an existing explicit record. Omitted or
// unresolved bindings never widen the subscription. All waits have a deadline.
export const workflowEventWaitConfig = z
  .strictObject({
    entity: z.literal("deal"),
    event: z.enum(workflowEventWaitKinds),
    recordId: bindingSchema.refine(
      (binding) =>
        binding.kind === "reference" ||
        (binding.literalType === undefined && dealId.safeParse(binding.value).success),
    ),
    updatedFields: workflowRecordEventWatchFields.nullable().optional(),
    timeoutMinutes: z.number().int().min(1).max(workflowEventWaitMaxMinutes),
  })
  .refine(({ event, updatedFields }) => event !== "deleted" || updatedFields == null);

export type WorkflowEventWaitConfig = z.infer<typeof workflowEventWaitConfig>;

export function workflowEventWaitTarget(
  nodeId: string,
  path: readonly string[],
): MappingTarget | undefined {
  return path.length === 1 && path[0] === "recordId"
    ? {
        nodeId,
        path,
        contract: { kind: "entity", entity: "deal", nullable: false },
        required: true,
        mode: "binding",
      }
    : undefined;
}

export function workflowEventWaitDeadline(armedAt: Date, timeoutMinutes: number): Date | null {
  if (
    !Number.isInteger(timeoutMinutes) ||
    timeoutMinutes < 1 ||
    timeoutMinutes > workflowEventWaitMaxMinutes
  )
    return null;
  const deadline = new Date(armedAt.getTime() + timeoutMinutes * 60_000);
  return Number.isFinite(deadline.getTime()) ? deadline : null;
}

export function workflowEventWaitOutput(event: WorkflowRecordEventData | null) {
  return event === null
    ? { hasTimedOut: true }
    : { hasTimedOut: false, ...workflowRecordEventOutput(event) };
}
