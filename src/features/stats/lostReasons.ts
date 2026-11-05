// Why deals were lost in the range, by count and value.
// Two write paths land a reason: MarkLostDialog sets lost_reason_id, while the deal-update
// API accepts free text in lost_reason. Rows are keyed on the id when there is one and fall
// back to the text, so a typed reason is not silently filed under "no reason".
// Windows on lost_time, and applies dealVisibilityClause.

import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { PermSetUser } from "@/features/permissions/effective";
import { canonicalMoney } from "@/lib/canonicalMoney";
import type { DashboardFilters, LostReasonCount } from "@/types/stats";
import { dealMetricPopulation, visibleDealPopulation } from "./dealPopulation";
import { encodeLostReasonSelection, lostReasonBinding } from "./lostReasonSelection";

export async function lostReasonBreakdown(
  db: Db,
  actor: PermSetUser,
  filters: DashboardFilters,
  signal: AbortSignal,
): Promise<LostReasonCount[]> {
  signal.throwIfAborted();
  const visible = await visibleDealPopulation(db, actor, filters, signal);
  const population = dealMetricPopulation("lost", filters);

  const result = await db.execute(sql`
    SELECT
      d.lost_reason_id AS "reasonId",
      coalesce(lr.name, d.lost_reason) COLLATE pg_catalog."C" AS "name",
      bool_and(lr.id IS NOT NULL) AS configured,
      count(*)::int AS "count",
      coalesce(sum(d.value), 0)::text AS "value"
    FROM deals d
    JOIN pipelines p ON p.id = d.pipeline_id
    LEFT JOIN lost_reasons lr ON lr.id = d.lost_reason_id
    WHERE ${visible} AND (${population})
    GROUP BY d.lost_reason_id, coalesce(lr.name, d.lost_reason) COLLATE pg_catalog."C"
    ORDER BY count(*) DESC, "name" ASC NULLS LAST
  `);

  signal.throwIfAborted();
  const binding = lostReasonBinding(actor.id, filters);
  const rows = (result as unknown as { rows: Array<LostReasonCount & { configured: boolean }> })
    .rows;
  return rows.map(({ configured, ...row }) => {
    const selector = encodeLostReasonSelection({ ...row, configured }, binding);
    return {
      ...row,
      value: canonicalMoney(row.value),
      ...(selector === undefined ? {} : { selector }),
    };
  });
}
