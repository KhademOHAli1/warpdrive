const LOCAL_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?$/;

function utcIsoFromParts(match: RegExpExecArray): string | null {
  const [year, month, day, hour, minute, second] = [1, 2, 3, 4, 5, 6].map((i) =>
    Number(match[i] ?? 0),
  );
  const millisecond = Number((match[7] ?? "").padEnd(3, "0").slice(0, 3));
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined
  ) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
  const roundTrips =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second;
  return roundTrips ? date.toISOString() : null;
}

export function parseImportDate(value: string): string | null {
  const trimmed = value.trim();
  const local = LOCAL_DATE_TIME.exec(trimmed);
  if (local !== null) return utcIsoFromParts(local);
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}
