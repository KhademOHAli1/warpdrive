export interface CurrencyTotal {
  currency: string;
  value: string;
}

const SCALE = 10_000n;

function scaled(value: string): bigint {
  const negative = value.startsWith("-");
  const [whole = "0", fraction = ""] = value.replace(/^[+-]/, "").split(".");
  const magnitude = BigInt(whole) * SCALE + BigInt(fraction.padEnd(4, "0"));
  return negative ? -magnitude : magnitude;
}

function decimal(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const magnitude = value < 0n ? -value : value;
  const fraction = (magnitude % SCALE)
    .toString()
    .padStart(4, "0")
    .replace(/0{1,2}$/, "");
  return `${sign}${magnitude / SCALE}.${fraction}`;
}

// Never sum different units. Missing currency is supported only for older client fixtures;
// persisted records always carry the currency assigned when they were created or migrated.
export function sumMoney(
  amounts: readonly { value: string | null; currency?: string }[],
  fallbackCurrency: string,
): CurrencyTotal[] {
  const totals = new Map<string, bigint>();
  for (const amount of amounts) {
    if (amount.value === null) continue;
    const currency = amount.currency ?? fallbackCurrency;
    totals.set(currency, (totals.get(currency) ?? 0n) + scaled(amount.value));
  }
  return [...totals]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, value]) => ({
      currency,
      value: decimal(value),
    }));
}

export function compareMoneyValues(left: string, right: string): number {
  const a = scaled(left);
  const b = scaled(right);
  return a < b ? -1 : a > b ? 1 : 0;
}
