import { useFormatters } from "@/lib/useFormatters";
import { useHydrated } from "@/lib/useHydrated";
import type { SalesOrderDetail } from "../contracts";

const moneyScale = 10_000n;

function scaledMoney(amount: string) {
  const [whole = "0", fraction = ""] = amount.split(".");
  return BigInt(whole) * moneyScale + BigInt(fraction.padEnd(4, "0"));
}

export function orderTotal(order: SalesOrderDetail): string | null {
  if (order.commercial === null) return null;
  let value = 0n;
  for (const line of order.lines) {
    if (line.unitPrice === null) return null;
    value += scaledMoney(line.unitPrice) * BigInt(line.quantity);
  }
  for (const charge of order.commercial.charges) value += scaledMoney(charge.amount);
  return `${value / moneyScale}.${String(value % moneyScale).padStart(4, "0")}`;
}

export function useSalesDisplay() {
  const format = useFormatters();
  const hydrated = useHydrated();
  return {
    amount: (value: string, currency: string) =>
      hydrated ? format.currency(value, currency) : `${value} ${currency}`,
    quantity: (value: number) => (hydrated ? format.number(value) : String(value)),
    date: (value: string) => (hydrated ? format.dateOnly(value) : value),
  };
}
