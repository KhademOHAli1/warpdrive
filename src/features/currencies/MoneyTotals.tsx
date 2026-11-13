"use client";

import { useFormatters } from "@/lib/useFormatters";
import type { CurrencyTotal } from "./money";

export function MoneyTotals({
  totals,
  formatCurrency,
}: {
  totals: readonly CurrencyTotal[];
  formatCurrency?: (value: string, currency: string) => string;
}) {
  const format = useFormatters();
  const currencyLabel = formatCurrency ?? format.currency;
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-3 gap-y-1">
      {totals.map(({ currency, value }) => (
        <bdi key={currency} dir="auto" className="whitespace-nowrap tabular-nums">
          {currencyLabel(value, currency)}{" "}
          <span className="text-[0.85em] text-muted-foreground">{currency}</span>
        </bdi>
      ))}
    </span>
  );
}
