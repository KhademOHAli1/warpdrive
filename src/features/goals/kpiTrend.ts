import { evaluateKpiRecords, type KpiRecord } from "./kpiEngine";
import type { KpiDefinitionInput } from "./kpiModel";

const DAY = 86_400_000;
const MAX_POINTS = 60;

function civilDay(value: string | undefined): number | null {
  if (value === undefined || value === "" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const time = new Date(`${value}T00:00:00Z`).getTime();
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : null;
}

/** Cumulative period-to-date measurements, sampled without inventing dates for source records. */
export function kpiTrend(
  definition: KpiDefinitionInput,
  records: KpiRecord[],
  bounds: { start: string; end: string },
  on: string,
): { day: string; value: string | null }[] {
  const start = civilDay(bounds.start);
  const periodEnd = civilDay(bounds.end);
  const asOf = civilDay(on);
  if (start === null || periodEnd === null || asOf === null) return [];
  const end = Math.min(periodEnd, asOf);
  if (end < start) return [];

  const dated = records.flatMap((record) => {
    const day = record.observedOn ?? record.measuredOn;
    const time = civilDay(day);
    return time !== null && time >= start && time <= end ? [{ record, time }] : [];
  });
  const dayCount = Math.floor((end - start) / DAY) + 1;
  const pointCount = Math.min(MAX_POINTS, dayCount);
  return Array.from({ length: pointCount }, (_, index) => {
    const offset = pointCount === 1 ? 0 : Math.floor((index * (dayCount - 1)) / (pointCount - 1));
    const time = start + offset * DAY;
    const day = new Date(time).toISOString().slice(0, 10);
    const measurement = evaluateKpiRecords(
      definition,
      dated.filter((row) => row.time <= time).map((row) => row.record),
      { start: bounds.start, end: day },
      { on: day },
    );
    return { day, value: measurement.state === "unavailable" ? null : measurement.value };
  });
}
