const bounds = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 6],
] as const;
type Range = { start: number; end: number; step: number };
function parsePart(value: string, min: number, max: number): Range | null {
  const match = /^(\*|\d{1,2}(?:-\d{1,2})?)(?:\/(\d{1,3}))?$/.exec(value);
  if (match === null) return null;
  const step = Number(match[2] ?? 1);
  if (step < 1) return null;
  if (match[1] === "*") return { start: min, end: max, step };
  const [low, high] = (match[1] ?? "").split("-");
  const start = Number(low),
    end = Number(high ?? low);
  return start >= min && end <= max && start <= end ? { start, end, step } : null;
}
function parseCron(value: unknown): { ranges: Range[][]; fields: string[] } | null {
  if (typeof value !== "string" || value.length > 100) return null;
  const fields = value.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const ranges: Range[][] = [];
  for (const [index, field] of fields.entries()) {
    const [min, max] = bounds[index] ?? [0, 0];
    const parts = field.split(",").map((part) => parsePart(part, min, max));
    if (parts.some((part) => part === null)) return null;
    ranges.push(parts.filter((part): part is Range => part !== null));
  }
  return { ranges, fields };
}
function formatter(timeZone: unknown): Intl.DateTimeFormat | null {
  if (timeZone !== undefined && typeof timeZone !== "string") return null;
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone ?? "UTC",
      minute: "numeric",
      hour: "numeric",
      hourCycle: "h23",
      day: "numeric",
      month: "numeric",
      weekday: "short",
    });
  } catch {
    return null;
  }
}
function validInterval(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 525_600;
}
export function validSchedule(config: Record<string, unknown>): boolean {
  if (config.mode === "interval") return validInterval(config.intervalMinutes);
  return parseCron(config.cron) !== null && formatter(config.timeZone) !== null;
}
export function scheduleMatches(config: Record<string, unknown>, now: Date): boolean {
  if (config.mode === "interval")
    return (
      validInterval(config.intervalMinutes) &&
      Math.floor(now.getTime() / 60_000) % config.intervalMinutes === 0
    );
  const cron = parseCron(config.cron),
    format = formatter(config.timeZone);
  if (cron === null || format === null) return false;
  const parts = format.formatToParts(now);
  const part = (name: string) => parts.find((item) => item.type === name)?.value ?? "";
  const values = [
    Number(part("minute")),
    Number(part("hour")),
    Number(part("day")),
    Number(part("month")),
    ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(part("weekday")),
  ];
  const matches = cron.ranges.map((ranges, index) =>
    ranges.some(({ start, end, step }) => {
      const value = values[index] ?? -1;
      return value >= start && value <= end && (value - start) % step === 0;
    }),
  );
  const day =
    cron.fields[2] !== "*" && cron.fields[4] !== "*"
      ? matches[2] === true || matches[4] === true
      : matches[2] === true && matches[4] === true;
  return matches[0] === true && matches[1] === true && matches[3] === true && day;
}
