import { Temporal } from "@js-temporal/polyfill";

export type ZonedInstant = Date | string | number;
function instant(value: ZonedInstant): Temporal.Instant {
  return typeof value === "string"
    ? Temporal.Instant.from(value)
    : Temporal.Instant.fromEpochMilliseconds(value instanceof Date ? value.getTime() : value);
}
export function instantCivilDate(value: ZonedInstant, timeZone = "UTC"): string {
  return instant(value).toZonedDateTimeISO(timeZone).toPlainDate().toString();
}
export function instantParts(value: ZonedInstant, timeZone = "UTC") {
  const z = instant(value).toZonedDateTimeISO(timeZone);
  return {
    date: z.toPlainDate().toString(),
    time: `${String(z.hour).padStart(2, "0")}:${String(z.minute).padStart(2, "0")}`,
    offset: z.offset,
  };
}
// New ambiguous times use the earlier occurrence. A gap is rejected instead of silently moved.
// Untouched edits must retain the original ISO instant, not call this inverse conversion.
export function wallTimeToInstant(date: string, time: string, timeZone = "UTC") {
  const local = Temporal.PlainDateTime.from(`${date}T${time}`, { overflow: "reject" });
  const earlier = local.toZonedDateTime(timeZone, { disambiguation: "earlier" });
  const later = local.toZonedDateTime(timeZone, { disambiguation: "later" });
  if (!earlier.toPlainDateTime().equals(local))
    throw new RangeError("nonexistent activity wall time");
  return {
    iso: new Date(earlier.epochMilliseconds).toISOString(),
    offset: earlier.offset,
    ambiguous: earlier.epochNanoseconds !== later.epochNanoseconds,
  };
}
export function civilDateRange(
  start: string,
  endExclusive: string,
  timeZone = "UTC",
): { from: Date; to: Date } {
  const at = (day: string) =>
    new Date(Temporal.PlainDate.from(day).toZonedDateTime(timeZone).epochMilliseconds);
  return { from: at(start), to: at(endExclusive) };
}
export function addCivilDays(date: string, days: number): string {
  return Temporal.PlainDate.from(date).add({ days }).toString();
}
