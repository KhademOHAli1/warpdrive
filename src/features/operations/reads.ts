import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gt, isNull, lt, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  operationsCurrent,
  operationsIncidents,
  operationsReceipts,
  operationsSources,
} from "@/db/schema";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import { currentNativeActor } from "@/features/auth/currentNativeActor";
import type { AppContext } from "@/server/trpc/context";
import { requireOperationsAdmin } from "./policy";
import { projectOperationsCurrent } from "./projection";
import type { OperationsCurrentCursor } from "./repository";
import { operationsInstallationId, operationsNow } from "./storage";

export const OPERATIONS_PAGE_SIZE = 30;
export interface OperationsHistoryCursor {
  at: string;
  id: string;
}

/** The complete read stays inside the current-authority fence. Cached request role
 * flags and request-selected installation IDs are never authorization evidence.
 */
export async function withOperationsAdminRead<T>(
  ctx: AppContext,
  requestSignal: AbortSignal | undefined,
  run: (tx: Db, installationId: string | null, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const timeout = AbortSignal.timeout(12_000);
  const signal = requestSignal ? AbortSignal.any([requestSignal, timeout]) : timeout;
  if (!ctx.session || !ctx.actor) throw new TRPCError({ code: "UNAUTHORIZED" });
  const session = ctx.session;
  const expectedActor = ctx.actor.id;
  try {
    return await withCurrentAuthority(ctx.db, "read", signal, async (tx) => {
      const current = await currentNativeActor(tx, session, signal);
      if (
        !current ||
        current.actor.id !== expectedActor ||
        !requireOperationsAdmin(current.actor).ok
      )
        throw new TRPCError({ code: "FORBIDDEN" });
      const installationId = await operationsInstallationId(tx, signal);
      const result = await run(tx, installationId, signal);
      signal.throwIfAborted();
      return result;
    });
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Operations monitoring is unavailable.",
    });
  }
}

export async function readOperationsCurrent(
  tx: Db,
  installationId: string | null,
  signal: AbortSignal,
  cursor?: OperationsCurrentCursor,
) {
  if (installationId === null)
    return {
      items: [],
      nextCursor: null,
      checkedAt: (await operationsNow(tx, signal)).toISOString(),
    };
  const after = cursor
    ? or(
        gt(operationsCurrent.sourceId, cursor.sourceId),
        and(
          eq(operationsCurrent.sourceId, cursor.sourceId),
          gt(operationsCurrent.observationKey, cursor.observationKey),
        ),
      )
    : undefined;
  const rows = await tx
    .select({ current: operationsCurrent, source: operationsSources })
    .from(operationsCurrent)
    .innerJoin(operationsSources, eq(operationsSources.id, operationsCurrent.sourceId))
    .where(and(eq(operationsSources.installationId, installationId), after))
    .orderBy(asc(operationsCurrent.sourceId), asc(operationsCurrent.observationKey))
    .limit(OPERATIONS_PAGE_SIZE);
  const now = await operationsNow(tx, signal);
  const last = rows.at(-1)?.current;
  return {
    items: rows.map((row) => projectOperationsCurrent(row.current, row.source, now)),
    nextCursor:
      rows.length === OPERATIONS_PAGE_SIZE && last
        ? { sourceId: last.sourceId, observationKey: last.observationKey }
        : null,
    checkedAt: now.toISOString(),
  };
}

export async function readOperationsSources(
  tx: Db,
  installationId: string | null,
  signal: AbortSignal,
  cursor?: string,
) {
  if (installationId === null) return { items: [], nextCursor: null };
  const rows = await tx
    .select({ source: operationsSources, highestSequence: operationsSources.highestSequence })
    .from(operationsSources)
    .where(
      and(
        eq(operationsSources.installationId, installationId),
        cursor !== undefined ? gt(operationsSources.id, cursor) : undefined,
      ),
    )
    .orderBy(asc(operationsSources.id))
    .limit(OPERATIONS_PAGE_SIZE);
  signal.throwIfAborted();
  return {
    items: rows.map((row) => ({
      sourceId: row.source.id,
      role: row.source.role,
      active: row.source.active,
      admissionState: row.source.admissionState,
      generationId: row.source.currentGenerationId,
      highestSequence: row.highestSequence,
      createdAt: row.source.createdAt.toISOString(),
    })),
    nextCursor: rows.length === OPERATIONS_PAGE_SIZE ? (rows.at(-1)?.source.id ?? null) : null,
  };
}

export async function readOperationsIncidents(
  tx: Db,
  installationId: string | null,
  signal: AbortSignal,
  openOnly: boolean,
  cursor?: OperationsHistoryCursor,
) {
  if (installationId === null) return { items: [], nextCursor: null };
  const after = cursor
    ? or(
        lt(operationsIncidents.updatedAt, new Date(cursor.at)),
        and(
          eq(operationsIncidents.updatedAt, new Date(cursor.at)),
          lt(operationsIncidents.id, cursor.id),
        ),
      )
    : undefined;
  const rows = await tx
    .select({ incident: operationsIncidents })
    .from(operationsIncidents)
    .innerJoin(operationsSources, eq(operationsSources.id, operationsIncidents.sourceId))
    .where(
      and(
        eq(operationsSources.installationId, installationId),
        openOnly ? isNull(operationsIncidents.recoveredAt) : undefined,
        after,
      ),
    )
    .orderBy(desc(operationsIncidents.updatedAt), desc(operationsIncidents.id))
    .limit(OPERATIONS_PAGE_SIZE);
  signal.throwIfAborted();
  const last = rows.at(-1)?.incident;
  return {
    items: rows.map(({ incident }) => ({
      id: incident.id,
      sourceId: incident.sourceId,
      observationKey: incident.observationKey,
      state: incident.state,
      reason: incident.reason,
      revision: incident.revision,
      openedAt: incident.openedAt.toISOString(),
      updatedAt: incident.updatedAt.toISOString(),
      recoveredAt: incident.recoveredAt?.toISOString() ?? null,
    })),
    nextCursor:
      rows.length === OPERATIONS_PAGE_SIZE && last
        ? { at: last.updatedAt.toISOString(), id: last.id }
        : null,
  };
}

export async function readOperationsEvents(
  tx: Db,
  installationId: string | null,
  signal: AbortSignal,
  cursor?: OperationsHistoryCursor,
) {
  if (installationId === null) return { items: [], nextCursor: null };
  const after = cursor
    ? or(
        lt(operationsReceipts.receivedAt, new Date(cursor.at)),
        and(
          eq(operationsReceipts.receivedAt, new Date(cursor.at)),
          lt(operationsReceipts.id, cursor.id),
        ),
      )
    : undefined;
  const rows = await tx
    .select({ receipt: operationsReceipts, recordedAt: operationsReceipts.receivedAt })
    .from(operationsReceipts)
    .innerJoin(operationsSources, eq(operationsSources.id, operationsReceipts.sourceId))
    .where(and(eq(operationsSources.installationId, installationId), after))
    .orderBy(desc(operationsReceipts.receivedAt), desc(operationsReceipts.id))
    .limit(OPERATIONS_PAGE_SIZE);
  signal.throwIfAborted();
  const last = rows.at(-1);
  return {
    items: rows.map(({ receipt, recordedAt }) => ({
      receiptId: receipt.id,
      sourceId: receipt.sourceId,
      generationId: receipt.generationId,
      sequence: receipt.sequence,
      payloadSha256: receipt.payloadSha256,
      observationCount: receipt.observationCount,
      observedAt: receipt.observedAt.toISOString(),
      receivedAt: receipt.receivedAt.toISOString(),
      recordedAt: recordedAt.toISOString(),
    })),
    nextCursor:
      rows.length === OPERATIONS_PAGE_SIZE && last
        ? { at: last.recordedAt.toISOString(), id: last.receipt.id }
        : null,
  };
}
