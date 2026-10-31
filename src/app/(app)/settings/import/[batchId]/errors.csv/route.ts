import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { importBatches } from "@/db/schema";
import { listDefs } from "@/features/custom-fields/defsRepo";
import { messagesForLocale } from "@/features/i18n/catalog";
import { getLocalePreferences } from "@/features/i18n/server";
import { narrowTarget } from "@/features/import/batchHelpers";
import { buildErrorCsv } from "@/features/import/errorReport";
import { loadErrorReportRows } from "@/features/import/errorReportRows";
import { can } from "@/features/permissions/can";
import { createContext } from "@/server/trpc/context";

const routeParams = z.object({ batchId: z.string().uuid() });

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ batchId: string }> },
): Promise<Response> {
  const preferences = await getLocalePreferences();
  const messages = messagesForLocale(preferences.locale).settings._extra.importDiagnostics;
  const parsed = routeParams.safeParse(await params);
  if (!parsed.success) return new NextResponse(messages.badRequest, { status: 400 });
  const { batchId } = parsed.data;
  const { actor, db } = await createContext();
  if (actor === null) return new NextResponse(messages.unauthorized, { status: 401 });
  if (!can(actor, "data.import")) return new NextResponse(messages.forbidden, { status: 403 });

  const [batch] = await db.select().from(importBatches).where(eq(importBatches.id, batchId));
  // Owner or admin, matching loadOwnedBatch (the tRPC read surfaces admins can already reach).
  if (batch === undefined || (batch.createdBy !== actor.id && actor.type !== "admin")) {
    return new NextResponse(messages.notFound, { status: 404 });
  }

  const target = narrowTarget(batch.targetEntity);
  const defs = target === "note" ? [] : await listDefs(db, target, {}, req.signal);

  const rows = await loadErrorReportRows(db, batchId, req.signal);

  const csv = buildErrorCsv(rows, { ...preferences, target, defs });
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="import-${batchId}-errors.csv"`,
    },
  });
}
