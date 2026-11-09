import { z } from "zod";
import { currencyCode } from "@/features/currencies/currencySchema";
import { isTimeZone } from "@/features/i18n/preferences";
import type { OwnerScope } from "@/types/stats";
import { lostReasonSelector } from "./lostReasonSelector";
import { DEAL_RECORD_METRICS, type DealRecordMetric } from "./metricDictionary";
import { fromToken, toToken } from "./ownerScopeToken";
import {
  ownerScopeInput,
  validLostReasonScope,
  validWonMonthScope,
  wonMonthInput,
} from "./schemas";

export const DEAL_REPORT_EXPORT_LIMIT = 100;
const MAX_QUERY_BYTES = 384;
const civilDate = z.iso.date().refine((value) => !value.startsWith("0000-"));
const currency = z
  .string()
  .length(3)
  .regex(/^[A-Z]{3}$/)
  .pipe(currencyCode);
export const exportTimeZone = z.string().max(100).refine(isTimeZone);
const ownerSelector = z
  .string()
  .max(41)
  .transform((token, ctx) => {
    const decoded = ownerScopeInput.safeParse(fromToken(token));
    if (!decoded.success || toToken(decoded.data) !== token) {
      ctx.addIssue({ code: "custom", message: "Invalid owner selector" });
      return z.NEVER;
    }
    return decoded.data;
  });
const query = z
  .strictObject({
    from: civilDate,
    to: civilDate,
    pipelineId: z.union([z.literal("all"), z.uuid()]),
    currency,
    ownerScope: ownerSelector,
    metric: z.enum(DEAL_RECORD_METRICS),
    wonMonth: wonMonthInput,
    lostReason: lostReasonSelector.optional(),
    timeZone: exportTimeZone,
  })
  .refine(({ from, to }) => from <= to)
  .refine(validWonMonthScope)
  .refine(validLostReasonScope);

export interface DealReportExportScope {
  from: string;
  to: string;
  pipelineId: string | null;
  currency: string;
  ownerScope: OwnerScope;
  metric: DealRecordMetric;
  wonMonth?: string;
  lostReason?: string;
  timeZone: string;
}

export function parseDealReportExportRequest(
  url: Pick<URL, "search" | "searchParams">,
): DealReportExportScope | null {
  if (
    url.search.length > MAX_QUERY_BYTES ||
    new TextEncoder().encode(url.search).length > MAX_QUERY_BYTES
  )
    return null;
  const fields = new Map<string, string>();
  for (const [name, value] of url.searchParams) {
    if (!Object.hasOwn(query.shape, name) || fields.has(name)) return null;
    fields.set(name, value);
  }
  const parsed = query.safeParse(Object.fromEntries(fields));
  if (!parsed.success) return null;
  const { pipelineId, ...scope } = parsed.data;
  return { ...scope, pipelineId: pipelineId === "all" ? null : pipelineId };
}

/** The current report response supplies the effective scope and display time zone. */
export function dealReportExportHref(scope: DealReportExportScope): string | null {
  const { wonMonth, lostReason, ...scopeFields } = scope;
  const fields = {
    ...scopeFields,
    pipelineId: scope.pipelineId ?? "all",
    ownerScope: toToken(scope.ownerScope),
  };
  const params = new URLSearchParams(fields);
  if (wonMonth !== undefined) params.set("wonMonth", wonMonth);
  if (lostReason !== undefined) params.set("lostReason", lostReason);
  return query.safeParse(Object.fromEntries(params)).success &&
    params.toString().length < MAX_QUERY_BYTES
    ? `/dashboard/export?${params}`
    : null;
}
