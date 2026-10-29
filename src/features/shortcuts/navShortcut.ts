import { normalizeDigits } from "@/utils/normalizeNumberInput";

// Pipedrive binds the number row to the primary nav: 1 goes to the first item, 2 to the second and
// so on. Keys past the end of our nav are unbound rather than clamped, so nothing surprising fires.

export function navHrefForKey(key: string, items: readonly { href: string }[]): string | null {
  const digit = normalizeDigits(key);
  if (digit.length !== 1 || digit < "1" || digit > "9") return null;
  return items[Number(digit) - 1]?.href ?? null;
}
