// Shared Add-deal / Add-lead form-field parsing. Both entities persist the same money and label
// shapes, so keeping this in one place stops the two forms from drifting (e.g. one rounding money
// differently from the other and silently failing the server's moneyAmount check).
import { moneyAmount } from "@/features/currencies/currencySchema";
import { canonicalMoney } from "@/lib/canonicalMoney";
import type { FormattingLocale } from "@/lib/localeFormatting";
import { normalizeNumberInput } from "./normalizeNumberInput";

// Trim to null: blank optional strings collapse to null so an empty input never persists "".
export function orNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t === "" ? null : t;
}

export type MoneyParse = { ok: true; value: number | string | null } | { ok: false; error: string };

// Blank -> no value; otherwise a non-negative amount with up to four decimal places. Callers surface `error` as the form validation message.
export function parseMoneyValue(raw: string, locale: FormattingLocale = "en"): MoneyParse {
  const t = raw.trim();
  if (t === "") return { ok: true, value: null };
  const normalized = normalizeNumberInput(t, locale);
  const n = normalized === null ? Number.NaN : Number(normalized);
  if (normalized === null || !moneyAmount.safeParse(normalized).success) {
    return { ok: false, error: "Value must be a non-negative number" };
  }
  const exact = canonicalMoney(normalized);
  return { ok: true, value: canonicalMoney(String(n)) === exact ? n : exact };
}

// Coerce a single label value: keep any non-blank catalog name, null out blanks. Labels are
// user-managed now, so there is no fixed key set to validate against here.
export function resolveLabelKey(raw: string | null | undefined): string | null {
  return orNull(raw);
}
