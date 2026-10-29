import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { readBaseCurrency } from "@/features/settings/readBaseCurrency";

// Every monetary report selects one unit before aggregating, including direct repository calls.
export async function reportCurrencyClause(
  db: Db,
  currency: string | undefined,
  signal: AbortSignal,
) {
  const unit = currency ?? (await readBaseCurrency(db, signal));
  return sql`AND d.currency = ${unit}`;
}
