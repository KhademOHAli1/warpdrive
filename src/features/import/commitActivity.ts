import { sql } from "drizzle-orm";
import type { z } from "zod";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { IMPORT_REMINDER_MIN_LEAD_MS, REMINDER_LEAD_MINUTES } from "@/constants/jobNames";
import { activityTypes } from "@/db/schema";
import { type CreateActivityOptions, createActivity } from "@/features/activities/repo";
import { activityCreateInput } from "@/features/activities/schemas";
import { can } from "@/features/permissions/can";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { err, ok, type Result } from "@/types/result";
import type { ImportActor } from "./commit";
import type { RowError } from "./commitHelpers";
import { authorityError, issuesOf } from "./commitHelpers";
import type { ImportContext } from "./externalIds";
import { activityImportRowSchema } from "./importRowSchemas";
import { type ResolvedRecordLinks, resolveRecordLinks } from "./resolveRecordLinks";
import { ownerCell, resolveMatchedUser } from "./rowOwners";

type ActivityRow = z.infer<typeof activityImportRowSchema>;

const DEFAULT_ACTIVITY_TYPE_KEY = "task";

async function activeTypeIds(
  tx: DbOrTx,
  match: ReturnType<typeof sql>,
  signal: AbortSignal,
): Promise<string[]> {
  signal.throwIfAborted();
  const rows = await tx
    .select({ id: activityTypes.id })
    .from(activityTypes)
    .where(sql`${match} and ${activityTypes.archivedAt} is null`);
  return rows.map((r) => r.id);
}

async function resolveTypeId(
  tx: DbOrTx,
  typeKey: string | null,
  signal: AbortSignal,
): Promise<Result<string, RowError[]>> {
  const key = typeKey ?? DEFAULT_ACTIVITY_TYPE_KEY;
  const levels = [
    sql`${activityTypes.key} = ${key}`,
    sql`lower(${activityTypes.key}) = lower(${key})`,
    sql`lower(${activityTypes.name}) = lower(${key})`,
  ];
  for (const level of levels) {
    const ids = await activeTypeIds(tx, level, signal);
    if (ids.length > 1) {
      return err([{ field: "typeKey", message: `ambiguous activity type: ${key}` }]);
    }
    if (ids[0] !== undefined) return ok(ids[0]);
  }
  return err([{ field: "typeKey", message: `unknown activity type: ${key}` }]);
}

function shouldScheduleReminder(done: boolean, dueAt: string | null): boolean {
  if (done || dueAt === null) return false;
  const fireAt = new Date(dueAt).getTime() - REMINDER_LEAD_MINUTES * 60_000;
  return fireAt - Date.now() >= IMPORT_REMINDER_MIN_LEAD_MS;
}

interface PipedriveExtras {
  links: ResolvedRecordLinks;
  done: boolean;
  options: CreateActivityOptions;
}

const DEAL_AND_LEAD_MESSAGE = "activity links both a deal and a lead";
const DEAL_AND_LEAD_LINK_FIELDS = [
  "dealPipedriveId",
  "dealTitle",
  "leadPipedriveId",
  "leadTitle",
] as const;

function dealAndLeadConflict(data: ActivityRow): RowError[] {
  return DEAL_AND_LEAD_LINK_FIELDS.filter((field) => data[field] !== undefined).map((field) => ({
    field,
    message: DEAL_AND_LEAD_MESSAGE,
  }));
}

async function pipedriveExtras(
  tx: DbOrTx,
  actor: ImportActor,
  ctx: ImportContext,
  data: ActivityRow,
  signal: AbortSignal,
): Promise<Result<PipedriveExtras, RowError[]>> {
  if (ctx.source !== "pipedrive") {
    return ok({
      links: { dealId: null, leadId: null, personId: null, orgId: null },
      done: false,
      options: {},
    });
  }
  const resolved = await resolveRecordLinks(tx, actor, ctx, data, signal);
  if (resolved.ok === false) return resolved;
  if (resolved.value.dealId !== null && resolved.value.leadId !== null) {
    return err(dealAndLeadConflict(data));
  }
  const done = data.done === true;
  const options: CreateActivityOptions = {
    scheduleReminder: shouldScheduleReminder(done, data.dueAt),
  };
  if (done && data.doneAt !== undefined) options.doneAtOverride = new Date(data.doneAt);
  return ok({ links: resolved.value, done, options });
}

export async function applyCreateActivity(
  tx: DbOrTx,
  actor: ImportActor,
  mapped: Record<string, unknown>,
  ctx: ImportContext,
  signal: AbortSignal,
): Promise<Result<{ id: string; warnings: RowError[] }, RowError[]>> {
  const parsed = activityImportRowSchema.safeParse(mapped);
  if (parsed.success === false) return err(issuesOf(parsed.error));
  if (can(actor, "activity.create") === false) {
    return err(
      authorityError(
        new AppError(ERROR_IDS.PERM_DENIED, "activity.create capability required", {
          userId: actor.id,
        }),
      ),
    );
  }

  const typeResult = await resolveTypeId(tx, parsed.data.typeKey, signal);
  if (typeResult.ok === false) return typeResult;

  const warnings: RowError[] = [];
  let assigneeId: string | undefined;
  const assigneeValue = ctx.source === "pipedrive" ? ownerCell(parsed.data, "assignee") : null;
  if (assigneeValue !== null) {
    const resolved = await resolveMatchedUser(tx, "assignee", "assignee", assigneeValue, signal);
    if ("userId" in resolved) assigneeId = resolved.userId;
    else warnings.push(resolved.warning);
  }

  const extras = await pipedriveExtras(tx, actor, ctx, parsed.data, signal);
  if (extras.ok === false) return extras;

  const candidate = {
    ...extras.value.links,
    done: extras.value.done,
    assigneeId,
    typeId: typeResult.value,
    subject: parsed.data.subject,
    dueAt: parsed.data.dueAt,
    allDay: parsed.data.allDay,
    dueDate: parsed.data.dueDate,
    durationMinutes: parsed.data.durationMinutes,
    customFields: parsed.data.customFields,
  };
  const finalParsed = activityCreateInput.safeParse(candidate);
  if (finalParsed.success === false) return err(issuesOf(finalParsed.error));

  const result = await createActivity(tx, actor, finalParsed.data, signal, extras.value.options);
  if (result.ok === false) return err(authorityError(result.error));
  return ok({ id: result.value.id, warnings });
}
