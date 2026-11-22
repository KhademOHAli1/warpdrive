import { InventoryDomainError } from "../../errors";
import type { EngineeringChangeError, EngineeringChangeResult } from "./contracts";

const known = new Set<string>([
  "unavailable",
  "invalid",
  "staleReview",
  "conflict",
  "packageIncomplete",
  "effectiveDate",
  "stockUnavailable",
  "temporary",
] satisfies EngineeringChangeError[]);

export function failEngineering(code: EngineeringChangeError): never {
  throw new InventoryDomainError(code);
}

export function engineeringFailure(error: string): EngineeringChangeResult<never> {
  return { ok: false, error: known.has(error) ? (error as EngineeringChangeError) : "unavailable" };
}
