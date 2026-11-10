import { z } from "zod";
import { composeDueAtIso } from "@/features/activities/activityTime";
import { activityReminderTimeZone } from "@/features/activities/reminderIntentTypes";
import { instantCivilDate } from "@/lib/zonedDateTime";
import { isMappingDate, isMappingInstant } from "./mappingLiteralIntent";
import type { MappingTarget } from "./mappingTypes";
import { type Binding, bindingSchema } from "./schemas";

const MAX_TITLE = 255;
const MAX_LOCATION = 255;
// Keep escaped plain text within the native note's 50,000-character limit.
const MAX_DESCRIPTION = 8_000;
const MAX_DURATION_MINUTES = 2_147_483_647;

export const workflowCalendarEventFields = [
  { key: "title", required: true, maxLength: MAX_TITLE },
  { key: "description", required: false, maxLength: MAX_DESCRIPTION },
  { key: "location", required: false, maxLength: MAX_LOCATION },
  { key: "startsAt", required: true, maxLength: 48 },
  { key: "endsAt", required: true, maxLength: 48 },
] as const;
export type WorkflowCalendarEventField = (typeof workflowCalendarEventFields)[number];
export type WorkflowCalendarEventFieldKey = WorkflowCalendarEventField["key"];

const noNul = (value: string) => !value.includes("\0");
const composeText = {
  title: z.string().trim().min(1).max(MAX_TITLE).refine(noNul),
  description: z.string().max(MAX_DESCRIPTION).refine(noNul),
  location: z.string().trim().max(MAX_LOCATION).refine(noNul),
};
const boundaryText = z.string().max(48);
export const workflowCalendarEventValues = z.strictObject({
  title: composeText.title,
  description: composeText.description.optional(),
  location: composeText.location.optional(),
  startsAt: boundaryText,
  endsAt: boundaryText,
});

function dateAnchor(value: unknown, timeZone: string): string | null {
  if (!isMappingDate(value)) return null;
  const iso = composeDueAtIso(value, "", timeZone);
  // A jurisdiction can skip an entire civil day. Do not store a shifted event.
  return iso !== null && instantCivilDate(iso, timeZone) === value ? iso : null;
}

function instantAnchor(value: unknown): string | null {
  if (!isMappingInstant(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function workflowCalendarEventBounds(
  startsAt: string,
  endsAt: string,
  allDay: boolean,
  timeZone: string,
) {
  const dueAt = allDay ? dateAnchor(startsAt, timeZone) : instantAnchor(startsAt);
  const endAt = allDay ? dateAnchor(endsAt, timeZone) : instantAnchor(endsAt);
  if (dueAt === null || endAt === null) return null;
  const elapsed = Date.parse(endAt) - Date.parse(dueAt);
  const durationMinutes = Math.ceil(elapsed / 60_000);
  if (allDay ? endsAt < startsAt : elapsed <= 0 || durationMinutes > MAX_DURATION_MINUTES)
    return null;
  return {
    dueAt,
    endAt,
    allDay,
    dueDate: allDay ? startsAt : null,
    endDate: allDay ? endsAt : null,
    durationMinutes: allDay ? null : durationMinutes,
    authoredTimeZone: timeZone,
  };
}

function validLiteral(
  key: WorkflowCalendarEventFieldKey,
  binding: Extract<Binding, { kind: "value" }>,
  allDay: boolean,
  timeZone: string,
): boolean {
  if (key !== "startsAt" && key !== "endsAt")
    return binding.literalType === undefined && composeText[key].safeParse(binding.value).success;
  if (!boundaryText.safeParse(binding.value).success) return false;
  return allDay
    ? binding.literalType === "date" && dateAnchor(binding.value, timeZone) !== null
    : binding.literalType === "instant" && instantAnchor(binding.value) !== null;
}

export const workflowCalendarEventConfig = z
  .strictObject({
    title: bindingSchema,
    startsAt: bindingSchema,
    endsAt: bindingSchema,
    allDay: z.boolean(),
    timeZone: activityReminderTimeZone,
    description: bindingSchema.optional(),
    location: bindingSchema.optional(),
  })
  .superRefine((config, context) => {
    const { startsAt, endsAt, allDay, timeZone } = config;
    let invalid = false;
    for (const { key } of workflowCalendarEventFields) {
      const binding = config[key];
      if (binding?.kind === "value" && !validLiteral(key, binding, allDay, timeZone)) {
        context.addIssue({ code: "custom", path: [key], message: "invalid_value" });
        invalid = true;
      }
    }
    if (
      !invalid &&
      startsAt.kind === "value" &&
      endsAt.kind === "value" &&
      typeof startsAt.value === "string" &&
      typeof endsAt.value === "string" &&
      workflowCalendarEventBounds(startsAt.value, endsAt.value, allDay, timeZone) === null
    ) {
      context.addIssue({ code: "custom", path: ["endsAt"], message: "out_of_range" });
    }
  });

export type WorkflowCalendarEventConfig = z.infer<typeof workflowCalendarEventConfig>;

export function workflowCalendarEventFieldTarget(
  nodeId: string,
  key: string,
  allDay: boolean,
): MappingTarget | undefined {
  const field = workflowCalendarEventFields.find((entry) => entry.key === key);
  if (field === undefined) return undefined;
  const isSchedule = field.key === "startsAt" || field.key === "endsAt";
  const kind = isSchedule ? (allDay ? "date" : "instant") : "text";
  return {
    nodeId,
    path: [field.key],
    contract: { kind, nullable: false },
    required: field.required,
    mode: "binding",
  };
}
