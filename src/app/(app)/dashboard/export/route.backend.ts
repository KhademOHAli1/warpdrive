import { TRPCError } from "@trpc/server";
import type { NextRequest } from "next/server";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { can } from "@/features/permissions/can";
import { serializeDealReportExport } from "@/features/stats/dealReportExportCsv";
import {
  DEAL_REPORT_EXPORT_LIMIT,
  parseDealReportExportRequest,
} from "@/features/stats/dealReportExportRequest";
import { createContext } from "@/server/trpc/context";
import { createCaller } from "@/server/trpc/root";

const cacheHeaders = { "cache-control": "private, no-store" };

function failure(message: string, status: number): Response {
  return new Response(message, { status, headers: cacheHeaders });
}

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const context = await createContext();
    const { actor, session } = context;
    if (actor === null || session === null || actor.id !== session.userId)
      return failure("Unauthorized", 401);
    if (!can(actor, "data.export")) return failure(ERROR_IDS.PERM_DENIED, 403);

    const scope = parseDealReportExportRequest(request.nextUrl);
    if (scope === null) return failure("Bad request", 400);
    const { timeZone, ...input } = scope;
    const report = await createCaller(context).stats.records({
      ...input,
      limit: DEAL_REPORT_EXPORT_LIMIT,
    });
    const result = serializeDealReportExport(report, { ...input, timeZone });
    if (result.state === "too-large") return failure("Export exceeds the row or byte limit", 422);
    if (result.state !== "ready") return failure("Export unavailable", 503);
    return new Response(result.csv, {
      headers: {
        ...cacheHeaders,
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="deal-report-${scope.metric}.csv"`,
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    if (
      error instanceof TRPCError &&
      error.cause instanceof AppError &&
      error.cause.id === ERROR_IDS.STATS_PIPELINE_NOT_VISIBLE
    )
      return failure("Export unavailable", 404);
    return failure("Export unavailable", 503);
  }
}
