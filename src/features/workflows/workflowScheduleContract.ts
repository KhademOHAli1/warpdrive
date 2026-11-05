import { z } from "zod";

const minute = z.number().int().min(0).max(59);
const hour = z.number().int().min(0).max(23);
const MAX_EXPRESSION_LENGTH = 120;
const expression = z
  .string()
  .max(MAX_EXPRESSION_LENGTH)
  .trim()
  .refine((value) => parseCron(value) !== null, "Invalid five-field UTC cron expression");

export const workflowScheduleConfig = z.discriminatedUnion("interval", [
  z.strictObject({ interval: z.literal("minutes"), minutes: z.number().int().min(1).max(60) }),
  z.strictObject({ interval: z.literal("hours"), hours: z.number().int().min(1).max(24), minute }),
  z.strictObject({
    interval: z.literal("days"),
    days: z.number().int().min(1).max(31),
    hour,
    minute,
  }),
  z.strictObject({ interval: z.literal("custom"), expression }),
]);
export type WorkflowScheduleConfig = z.infer<typeof workflowScheduleConfig>;

export const workflowScheduledAt = z.iso.datetime({ precision: 3 }).regex(/:00\.000Z$/u);

export const workflowSchedulePayload = z.strictObject({
  scope: z.literal("schedule"),
  scheduledAt: workflowScheduledAt,
});
export type WorkflowSchedulePayload = z.infer<typeof workflowSchedulePayload>;

interface ScheduleTriggerDefinition {
  nodes: readonly { id: string; type: string; version: number; config: unknown }[];
}

export function readWorkflowScheduleTrigger(definition: ScheduleTriggerDefinition) {
  const triggers = definition.nodes.filter((node) => node.type.startsWith("trigger."));
  const trigger = triggers[0];
  if (triggers.length !== 1 || trigger?.type !== "trigger.schedule" || trigger.version !== 1)
    return null;
  const config = workflowScheduleConfig.safeParse(trigger.config);
  return config.success ? { id: trigger.id, config: config.data } : null;
}

export function readWorkflowScheduleLaunch(
  definition: ScheduleTriggerDefinition,
  raw: unknown,
): WorkflowSchedulePayload | null {
  const trigger = readWorkflowScheduleTrigger(definition);
  const payload = workflowSchedulePayload.safeParse(raw);
  if (trigger === null || !payload.success) return null;
  return workflowScheduleMatches(trigger.config, payload.data.scheduledAt) ? payload.data : null;
}

const MINUTE_MS = 60_000;

export function workflowScheduleMinute(nowMs: number): string | null {
  const value = new Date(Math.floor(nowMs / MINUTE_MS) * MINUTE_MS);
  if (!Number.isFinite(value.getTime())) return null;
  const parsed = workflowScheduledAt.safeParse(value.toISOString());
  return parsed.success ? parsed.data : null;
}

export function workflowScheduleExpression(config: WorkflowScheduleConfig): string {
  switch (config.interval) {
    case "minutes":
      return `*/${config.minutes} * * * *`;
    case "hours":
      return `${config.minute} */${config.hours} * * *`;
    case "days":
      return `${config.minute} ${config.hour} */${config.days} * *`;
    case "custom":
      return config.expression;
  }
}

interface CronField {
  values: ReadonlySet<number>;
  unrestricted: boolean;
}

// Each list entry expands to at most the size of its field. Accept numeric cron
// only, with wildcards, lists, ranges and steps and either spelling of Sunday.
const cronEntry = /^(\*|\d{1,2})(?:-(\d{1,2}))?(?:\/(\d{1,2}))?$/u;
const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function cronBounds(raw: string, minimum: number, maximum: number) {
  const match = cronEntry.exec(raw);
  if (match === null || match[0] !== raw) return null;
  const [, start, end, step] = match;
  if (start === undefined || (start === "*" && end !== undefined)) return null;
  const from = start === "*" ? minimum : Number(start);
  const defaultEnd = start === "*" || step !== undefined ? maximum : from;
  const to = end === undefined ? defaultEnd : Number(end);
  const increment = step === undefined ? 1 : Number(step);
  if (from < minimum || from > to || to > maximum || increment < 1) return null;
  return { from, to, increment };
}

function parseField(raw: string, minimum: number, maximum: number): CronField | null {
  const values = new Set<number>();
  for (const entry of raw.split(",")) {
    const bounds = cronBounds(entry, minimum, maximum);
    if (bounds === null) return null;
    for (let value = bounds.from; value <= bounds.to; value += bounds.increment) values.add(value);
  }
  return { values, unrestricted: raw === "*" };
}

function parseCron(raw: string) {
  if (raw.length > MAX_EXPRESSION_LENGTH) return null;
  const [minutes, hours, daysOfMonth, months, daysOfWeek, extra] = raw.split(/[\t ]+/u);
  if (
    minutes === undefined ||
    hours === undefined ||
    daysOfMonth === undefined ||
    months === undefined ||
    daysOfWeek === undefined ||
    extra !== undefined
  )
    return null;
  const minuteField = parseField(minutes, 0, 59);
  const hourField = parseField(hours, 0, 23);
  const dayOfMonth = parseField(daysOfMonth, 1, 31);
  const month = parseField(months, 1, 12);
  const dayOfWeek = parseField(daysOfWeek, 0, 7);
  if (
    minuteField === null ||
    hourField === null ||
    dayOfMonth === null ||
    month === null ||
    dayOfWeek === null
  )
    return null;
  if (dayOfWeek.unrestricted && !hasPossibleDate(month, dayOfMonth)) return null;
  return { minuteField, hourField, dayOfMonth, month, dayOfWeek };
}

function hasPossibleDate(month: CronField, dayOfMonth: CronField): boolean {
  const earliest = Math.min(...dayOfMonth.values);
  return [...month.values].some((value) => earliest <= (daysInMonth[value - 1] ?? 0));
}

function matchesCronDay(dayOfMonth: CronField, dayOfWeek: CronField, at: Date): boolean {
  const dateMatches = dayOfMonth.values.has(at.getUTCDate());
  const weekday = at.getUTCDay();
  const weekdayMatches =
    dayOfWeek.values.has(weekday) || (weekday === 0 && dayOfWeek.values.has(7));
  if (dayOfWeek.unrestricted) return dateMatches;
  if (dayOfMonth.unrestricted) return weekdayMatches;
  return dateMatches || weekdayMatches;
}

export function workflowScheduleMatches(
  config: WorkflowScheduleConfig,
  scheduledAt: string,
): boolean {
  if (!workflowScheduledAt.safeParse(scheduledAt).success) return false;
  const cron = parseCron(workflowScheduleExpression(config));
  if (cron === null) return false;
  const at = new Date(scheduledAt);
  return (
    cron.minuteField.values.has(at.getUTCMinutes()) &&
    cron.hourField.values.has(at.getUTCHours()) &&
    cron.month.values.has(at.getUTCMonth() + 1) &&
    matchesCronDay(cron.dayOfMonth, cron.dayOfWeek, at)
  );
}
