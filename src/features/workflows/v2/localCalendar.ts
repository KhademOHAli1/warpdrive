import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { activityTypes } from "@/db/schema";
import { activityAccountPreferences } from "@/features/activities/accountTimeZone";
import { activityReminderTimeZone } from "@/features/activities/reminderIntentTypes";
import { createActivity } from "@/features/activities/repo";
import type { BlockOutput } from "@/features/blocks/contracts";
import { resolvedBlockConfigSchemas } from "@/features/blocks/schemas";
import { can } from "@/features/permissions/can";
import type { PermSetUser } from "@/features/permissions/effective";
import { instantCivilDate } from "@/lib/zonedDateTime";
import { err, ok, type Result } from "@/types/result";
import { localRecipientAvailable } from "./localAuthority";

export async function localCalendarType(
  db: Db,
  id: string | undefined,
  signal: AbortSignal,
): Promise<string | null> {
  const rows = await db
    .select({ id: activityTypes.id })
    .from(activityTypes)
    .where(
      and(
        isNull(activityTypes.archivedAt),
        id === undefined ? eq(activityTypes.key, "meeting") : eq(activityTypes.id, id),
      ),
    )
    .orderBy(asc(activityTypes.order), asc(activityTypes.id))
    .limit(1);
  signal.throwIfAborted();
  return rows[0]?.id ?? null;
}
export function localCalendarNeedsProvider(input: {
  sendInvitations?: boolean;
  createConference?: boolean;
  attendeeEmails?: string[];
}): boolean {
  return (
    input.sendInvitations === true ||
    input.createConference === true ||
    (input.attendeeEmails?.length ?? 0) > 0
  );
}

export async function createLocalCalendarEvent(
  db: Db,
  actor: PermSetUser,
  raw: BlockOutput,
  signal: AbortSignal,
): Promise<Result<BlockOutput, string>> {
  const input = resolvedBlockConfigSchemas.CREATE_CALENDAR_EVENT.parse(raw);
  if (!can(actor, "activity.create")) return err("E_PERM_001");
  if (input.title.length > 255) return err("workflow_calendar_title_invalid");
  if (localCalendarNeedsProvider(input)) return err("workflow_calendar_provider_unavailable");
  if (Date.parse(input.endsAt) < Date.parse(input.startsAt))
    return err("workflow_calendar_dates_invalid");
  const typeId = await localCalendarType(db, input.typeId, signal);
  if (typeId === null) return err("workflow_calendar_type_unavailable");
  const assigneeId = input.assigneeId ?? actor.id;
  if (!(await localRecipientAvailable(db, assigneeId, signal, true)))
    return err("workflow_calendar_assignee_unavailable");
  const preferences = await activityAccountPreferences(db, actor.id);
  const zone = activityReminderTimeZone.parse(input.timeZone ?? preferences.timeZone);
  const created = await createActivity(
    db,
    actor,
    {
      typeId,
      subject: input.title,
      dueAt: new Date(input.startsAt).toISOString(),
      endAt: new Date(input.endsAt).toISOString(),
      allDay: input.allDay ?? false,
      authoredTimeZone: zone,
      assigneeId,
      dueDate: input.allDay === true ? instantCivilDate(input.startsAt, zone) : null,
      endDate: input.allDay === true ? instantCivilDate(input.endsAt, zone) : null,
      reminder: { kind: "none" },
    },
    signal,
    { scheduleReminder: false },
  );
  return created.ok
    ? ok({
        eventId: created.value.id,
        recordId: created.value.id,
        calendar: "local",
        invitationsSent: false,
        conferenceCreated: false,
      })
    : err(created.error.id);
}

export function localCalendarZoneValid(value: unknown): boolean {
  return value === undefined || activityReminderTimeZone.safeParse(value).success;
}
export function localCalendarId(value: unknown): string | undefined {
  const parsed = z.uuid().safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
