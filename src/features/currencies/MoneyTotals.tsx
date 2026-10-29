"use client";

import { useFormatters } from "@/lib/useFormatters";
import type { CurrencyTotal } from "./money";

export function MoneyTotals({ totals }: { totals: readonly CurrencyTotal[] }) {
  const format = useFormatters();
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-3 gap-y-1">
      {totals.map(({ currency, value }) => (
        <bdi key={currency} dir="auto" className="whitespace-nowrap tabular-nums">
          {format.currency(value, currency)}{" "}
          <span className="text-[0.85em] text-muted-foreground">{currency}</span>
        </bdi>
      ))}
    </span>
  );
}
