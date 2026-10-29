import { sumMoney } from "@/features/currencies/money";

export function accumulateSeries(
  days: readonly string[],
  totals: ReadonlyMap<string, { count: number; value: string }>,
  metric: "count" | "value",
  currency: string,
): { day: string; actual: string }[] {
  let runningCount = 0;
  let runningValue = "0.00";
  return days.map((day) => {
    const total = totals.get(day);
    if (total !== undefined) {
      runningCount += total.count;
      if (metric === "value")
        runningValue =
          sumMoney([{ value: runningValue }, { value: total.value }], currency)[0]?.value ?? "0.00";
    }
    return { day, actual: metric === "value" ? runningValue : String(runningCount) };
  });
}
