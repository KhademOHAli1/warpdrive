import { z } from "zod";

import { CURRENCY_CODES, HISTORICAL_CURRENCY_CODES } from "./codes";

const supportedCurrencies = new Set([...CURRENCY_CODES, ...HISTORICAL_CURRENCY_CODES]);
export const currencyCode = z
  .string()
  .trim()
  .toUpperCase()
  .refine((code) => supportedCurrencies.has(code), "Choose a supported currency code");

// The database holds fourteen integer and four fractional digits. Decimal strings preserve
// large native amounts (for example IRR) without forcing them through a floating-point value.
export const moneyAmount = z.union([
  z.number().finite().nonnegative().lt(100_000_000_000_000).multipleOf(0.0001),
  z.string().regex(/^\d{1,14}(\.\d{1,4})?$/),
]);
