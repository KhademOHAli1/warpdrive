import { type CatalogUnit, convertCatalogUnits } from "../catalog/contracts";
import { inventoryStockLimit } from "../schema";

export function wholeBomQuantity(entered: string, from: CatalogUnit, to: CatalogUnit) {
  const ratio = convertCatalogUnits(1, from, to);
  // Supported catalog factors are powers of ten. Work on integers after finding
  // the factor so a fractional warehouse unit cannot be accepted by rounding.
  if (ratio === null || !/^(?:0|[1-9]\d{0,6})(?:\.\d{1,6})?$/.test(entered)) return null;
  const [units = "", fraction = ""] = entered.split(".");
  const numerator = BigInt(units + fraction) * BigInt(Math.max(ratio, 1));
  const denominator =
    10n ** BigInt(fraction.length) * BigInt(ratio < 1 ? Math.round(1 / ratio) : 1);
  if (numerator % denominator !== 0n) return null;
  const quantity = numerator / denominator;
  return quantity > 0n && quantity <= BigInt(inventoryStockLimit) ? Number(quantity) : null;
}
