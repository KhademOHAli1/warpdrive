import { and, eq, isNull } from "drizzle-orm";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { activityTypes } from "@/db/schema";
import { createActivity } from "@/features/activities/repo";
import { activityCreateInput } from "@/features/activities/schemas";
import { plainTextToParagraphHtml } from "@/features/email/plainText";
import { can } from "@/features/permissions/can";
import type { PermSetUser } from "@/features/permissions/effective";
import { err, ok } from "@/types/result";
import { resolveRunBinding } from "./runBindings";
import type { RunOutputs } from "./runTypes";
import type { WorkflowDefinition } from "./schemas";
import {
  type WorkflowCalendarEventConfig,
  workflowCalendarEventBounds,
  workflowCalendarEventConfig,
  workflowCalendarEventFields,
  workflowCalendarEventValues,
} from "./workflowCalendarEventContract";
import { type RecordCreateMode, withRecordWriteTransaction } from "./workflowRecordCreate";

function resolveEventValues(
  config: WorkflowCalendarEventConfig,
  nodeId: string,
  outputs: RunOutputs,
  definition: WorkflowDefinition,
) {
  const values: Record<string, unknown> = {};
  for (const { key } of workflowCalendarEventFields) {
    const binding = config[key];
    if (binding === undefined) continue;
    if (binding.kind === "value") {
      values[key] = binding.value;
      continue;
    }
    const resolved = resolveRunBinding(binding, outputs, { definition, nodeId, path: [key] });
    if (resolved.state === "invalid") return err(ERROR_IDS.WORKFLOW_INVALID);
    if (resolved.state !== "value") return err(ERROR_IDS.WORKFLOW_BINDING_MISSING);
    values[key] = resolved.value;
  }
  const parsed = workflowCalendarEventValues.safeParse(values);
  return parsed.success ? ok(parsed.data) : err(ERROR_IDS.WORKFLOW_INVALID);
}

async function writeLocalEvent(
  tx: Db,
  actor: PermSetUser,
  event: {
    bounds: NonNullable<ReturnType<typeof workflowCalendarEventBounds>>;
    title: string;
    description?: string;
    location?: string;
  },
  signal: AbortSignal,
) {
  const [type] = await tx
    .select({ id: activityTypes.id })
    .from(activityTypes)
    .where(and(eq(activityTypes.key, "meeting"), isNull(activityTypes.archivedAt)))
    .for("share");
  signal.throwIfAborted();
  if (type === undefined) return err(ERROR_IDS.WORKFLOW_NOT_READY);

  const input = activityCreateInput.safeParse({
    ...event.bounds,
    typeId: type.id,
    subject: event.title,
    location: event.location === "" ? null : event.location,
    note: event.description === undefined ? null : plainTextToParagraphHtml(event.description),
  });
  if (!input.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  // Native metadata retains the authored zone while the disabled selection has no fire time.
  const saved = await createActivity(tx, actor, input.data, signal, { scheduleReminder: false });
  signal.throwIfAborted();
  return saved.ok ? ok({ id: saved.value.id }) : err(saved.error.id);
}

export async function createWorkflowCalendarEvent(
  tx: Db,
  actor: PermSetUser,
  node: { id: string; version: number; config: unknown },
  outputs: RunOutputs,
  definition: WorkflowDefinition,
  mode: RecordCreateMode,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  if (node.version !== 1) return err(ERROR_IDS.WORKFLOW_NOT_READY);
  if (!("rollback" in tx)) return err(ERROR_IDS.WORKFLOW_WRITE_FAILED);
  if (!can(actor, "activity.create")) return err(ERROR_IDS.PERM_DENIED);
  const config = workflowCalendarEventConfig.safeParse(node.config);
  if (!config.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  const fields = resolveEventValues(config.data, node.id, outputs, definition);
  if (!fields.ok) return fields;
  const { startsAt, endsAt, ...event } = fields.value;
  const bounds = workflowCalendarEventBounds(
    startsAt,
    endsAt,
    config.data.allDay,
    config.data.timeZone,
  );
  if (bounds === null) return err(ERROR_IDS.WORKFLOW_INVALID);

  // Both preview entry points must roll back even before their outer transaction finishes.
  return withRecordWriteTransaction(tx, mode === "live" ? "live" : "simulation", signal, (work) =>
    writeLocalEvent(work, actor, { ...event, bounds }, signal),
  );
}
