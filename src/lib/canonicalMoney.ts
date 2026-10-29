// Keep the existing two-place API representation while preserving real third/fourth places.
// This operates on decimal strings, so widening database precision does not change amounts.
export function canonicalMoney(value: string): string {
  const [whole = "0", fraction = ""] = value.split(".");
  return `${whole.replace(/^0+(?=\d)/, "")}.${fraction.replace(/0+$/, "").padEnd(2, "0")}`;
}

export function moneyInputValue(value: string | number): string | number {
  if (typeof value === "number") return value;
  const exact = canonicalMoney(value);
  const numeric = Number(value);
  return canonicalMoney(String(numeric)) === exact ? numeric : exact;
}
