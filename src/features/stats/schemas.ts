import { z } from "zod";
import { currencyCode } from "@/features/currencies/currencySchema";
import { DEAL_WIN_COHORT_HORIZONS } from "./history/dealWinCohortView";
import { DEAL_RECORD_METRICS, type DealRecordMetric } from "./metricDictionary";
import { monthsInRange } from "./monthBuckets";

// Boundary validation for the dashboard procedure input.
// Query functions receive the validated/narrowed types and trust them.
export const ownerScopeInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("me") }),
  z.object({ kind: z.literal("all") }),
  z.object({ kind: z.literal("user"), userId: z.string().uuid() }),
  z.object({ kind: z.literal("team"), teamId: z.string().uuid() }),
]);

export const dashboardInput = z
  .object({
    // Cache identity only. Boundaries always use preferences loaded for the authenticated actor.
    timeZoneIdentity: z.string().max(80).optional(),
    currency: currencyCode.optional(),
    pipelineId: z.string().uuid().nullable().default(null),
    ownerScope: ownerScopeInput.default({ kind: "me" }),
    from: z.string().date(),
    to: z.string().date(),
  })
  .refine((range) => range.from <= range.to, {
    message: "Reporting range is reversed",
    path: ["to"],
  });

export const wonMonthInput = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .optional();

export function validWonMonthScope({
  from,
  to,
  metric,
  wonMonth,
}: {
  from: string;
  to: string;
  metric: DealRecordMetric;
  wonMonth?: string;
}): boolean {
  return wonMonth === undefined || (metric === "won" && monthsInRange(from, to).includes(wonMonth));
}

export const dealRecordsInput = dashboardInput
  .safeExtend({
    metric: z.enum(DEAL_RECORD_METRICS),
    limit: z.number().int().min(1).max(100).default(25),
    cursor: z
      .object({ createdAt: z.string().datetime({ offset: true }), id: z.string().uuid() })
      .optional(),
    wonMonth: wonMonthInput,
  })
  .refine(validWonMonthScope, {
    path: ["wonMonth"],
    message: "Select a displayed won trend month",
  });

export const dealWinCohortsInput = dashboardInput.safeExtend({
  // Cache identity only. The reader independently loads the viewer's saved calendar.
  calendarIdentity: z.enum(["gregory", "persian"]).optional(),
  horizon: z.enum(DEAL_WIN_COHORT_HORIZONS),
});

export const stageAgingInput = z.strictObject({
  currency: currencyCode.optional(),
  pipelineId: z.string().uuid().nullable().default(null),
  ownerScope: ownerScopeInput.default({ kind: "me" }),
});
