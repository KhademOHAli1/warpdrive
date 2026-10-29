// Cell highlighting follows the selected time zone when supplied. The optional legacy default
// preserves existing non-UI callers; server filtering has its own boundary policy.
export type NextActivityState = "none" | "overdue" | "today" | "upcoming";

export function nextActivityState(
  at: Date | string | null,
  now: Date,
  timeZone?: string,
): NextActivityState {
  if (at === null) return "none";
  const due = typeof at === "string" ? new Date(at) : at;

  if (timeZone !== undefined) {
    const fmt = new Intl.DateTimeFormat("en-CA-u-ca-gregory-nu-latn", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const day = (value: Date) => {
      const p = fmt.formatToParts(value);
      return ["year", "month", "day"]
        .map((key) => p.find((part) => part.type === key)?.value)
        .join("-");
    };
    const dueDay = day(due);
    const today = day(now);
    return dueDay < today ? "overdue" : dueDay === today ? "today" : "upcoming";
  }
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfTomorrow = startOfToday + 24 * 60 * 60 * 1000;
  const t = due.getTime();

  if (t < startOfToday) return "overdue";
  if (t < startOfTomorrow) return "today";
  return "upcoming";
}
