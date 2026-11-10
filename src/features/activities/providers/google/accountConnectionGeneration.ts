import { z } from "zod";

export const calendarConnectionGenerationsSchema = z.record(z.uuid(), z.number().int().positive());
export type CalendarConnectionGenerations = z.infer<typeof calendarConnectionGenerationsSchema>;

export function readCalendarConnectionGenerations(
  raw: unknown,
): CalendarConnectionGenerations | null {
  const parsed = calendarConnectionGenerationsSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function sameCalendarConnectionGenerations(
  left: CalendarConnectionGenerations,
  right: CalendarConnectionGenerations,
): boolean {
  const entries = Object.entries(left);
  return (
    entries.length === Object.keys(right).length &&
    entries.every(([id, generation]) => right[id] === generation)
  );
}

export function calendarConnectionGenerationMatches(
  snapshot: CalendarConnectionGenerations,
  account: { id: string; connectionGeneration: number },
): boolean {
  return (
    Object.hasOwn(snapshot, account.id) && snapshot[account.id] === account.connectionGeneration
  );
}
