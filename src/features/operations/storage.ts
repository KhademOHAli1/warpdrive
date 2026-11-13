import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { operationsInstallation, operationsSources } from "@/db/schema";
import {
  OPERATIONS_MAX_TIMESTAMP_MS,
  type OperationsSourceBinding,
  operationsSourceBindingSchema,
} from "./contracts";

export const OPERATIONS_TRANSACTION_DEADLINE_MS = 12_000;
export const OPERATIONS_SOURCE_LIMIT = 16;
export type OperationsSourceRole = typeof operationsSources.$inferSelect.role;
export const operationsSourceRoleSchema = z.enum([
  "host_collector",
  "application_sampler",
  "recovery_verifier",
]);

export function operationsInvariant(message: string): never {
  throw new AppError(ERROR_IDS.INTEGRATION_STATE_INVALID, message);
}

export async function operationsTransaction<T>(
  db: Db,
  signal: AbortSignal,
  run: (tx: Db, bounded: AbortSignal) => Promise<T>,
): Promise<T> {
  const bounded = AbortSignal.any([
    signal,
    AbortSignal.timeout(OPERATIONS_TRANSACTION_DEADLINE_MS),
  ]);
  bounded.throwIfAborted();
  return db.transaction(
    async (tx) => {
      const previous = await tx.execute<{
        statement_ms: string;
        lock_ms: string;
        idle_ms: string;
      }>(sql`
      SELECT (SELECT setting FROM pg_settings WHERE name='statement_timeout') AS statement_ms,
        (SELECT setting FROM pg_settings WHERE name='lock_timeout') AS lock_ms,
        (SELECT setting FROM pg_settings WHERE name='idle_in_transaction_session_timeout') AS idle_ms
    `);
      const settings = previous.rows[0];
      if (!settings) operationsInvariant("Operations transaction settings unavailable");
      await tx.execute(sql`SELECT
      set_config('statement_timeout',least(nullif(${settings.statement_ms}::int,0),5000)::text,true),
      set_config('lock_timeout',least(nullif(${settings.lock_ms}::int,0),2000)::text,true),
      set_config('idle_in_transaction_session_timeout',least(nullif(${settings.idle_ms}::int,0),10000)::text,true)`);
      bounded.throwIfAborted();
      const result = await run(tx, bounded);
      bounded.throwIfAborted();
      await tx.execute(sql`SELECT set_config('statement_timeout',${settings.statement_ms},true),
      set_config('lock_timeout',${settings.lock_ms},true),
      set_config('idle_in_transaction_session_timeout',${settings.idle_ms},true)`);
      bounded.throwIfAborted();
      return result;
    },
    { isolationLevel: "read committed" },
  );
}

export async function operationsNow(tx: Db, signal: AbortSignal): Promise<Date> {
  signal.throwIfAborted();
  const clock = await tx.execute<{ milliseconds: string }>(
    sql`SELECT floor(extract(epoch FROM clock_timestamp())*1000)::text AS milliseconds`,
  );
  signal.throwIfAborted();
  const milliseconds = Number(clock.rows[0]?.milliseconds);
  if (
    !Number.isSafeInteger(milliseconds) ||
    milliseconds < 0 ||
    milliseconds > OPERATIONS_MAX_TIMESTAMP_MS
  )
    operationsInvariant("Operations database clock unavailable");
  return new Date(milliseconds);
}

export async function operationsInstallationId(
  tx: Db,
  signal: AbortSignal,
): Promise<string | null> {
  signal.throwIfAborted();
  const [installation] = await tx
    .select({ id: operationsInstallation.installationId })
    .from(operationsInstallation)
    .limit(1);
  signal.throwIfAborted();
  return installation?.id ?? null;
}

async function lockInstallation(tx: Db, installationId?: string) {
  await tx
    .insert(operationsInstallation)
    .values({ singleton: true, installationId })
    .onConflictDoNothing();
  const [installation] = await tx
    .select({ id: operationsInstallation.installationId })
    .from(operationsInstallation)
    .where(eq(operationsInstallation.singleton, true))
    .for("update")
    .limit(1);
  if (!installation) operationsInvariant("Operations installation unavailable");
  return installation.id;
}

async function sourceCount(tx: Db, installationId: string) {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(operationsSources)
    .where(eq(operationsSources.installationId, installationId));
  return row?.count ?? OPERATIONS_SOURCE_LIMIT;
}

/** Host-only exact enrollment. Retrying a committed binding does not consume a slot. */
export async function provisionOperationsSource(
  db: Db,
  requested: { binding: OperationsSourceBinding; role: OperationsSourceRole },
  signal: AbortSignal,
): Promise<{ binding: OperationsSourceBinding; status: "created" | "existing" }> {
  const binding = operationsSourceBindingSchema.parse(requested.binding);
  const role = operationsSourceRoleSchema.parse(requested.role);
  return operationsTransaction(db, signal, async (tx, bounded) => {
    const installationId = await lockInstallation(tx, binding.installationId);
    if (installationId !== binding.installationId)
      operationsInvariant("Operations installation identity differs");
    const [source] = await tx
      .select({
        role: operationsSources.role,
        active: operationsSources.active,
        generationId: operationsSources.currentGenerationId,
      })
      .from(operationsSources)
      .where(
        and(
          eq(operationsSources.id, binding.sourceId),
          eq(operationsSources.installationId, installationId),
        ),
      )
      .for("update")
      .limit(1);
    if (source !== undefined) {
      if (!source.active || source.role !== role || source.generationId !== binding.generationId)
        operationsInvariant("Operations source binding differs from current enrollment");
      return { binding, status: "existing" };
    }
    if ((await sourceCount(tx, installationId)) >= OPERATIONS_SOURCE_LIMIT)
      operationsInvariant("Operations source budget exhausted");
    bounded.throwIfAborted();
    await tx.insert(operationsSources).values({
      id: binding.sourceId,
      installationId,
      role,
      currentGenerationId: binding.generationId,
    });
    return { binding, status: "created" };
  });
}

/** Internal provisioning only. No router or HTTP endpoint exposes enrollment. */
export async function enrollOperationsSource(
  db: Db,
  role: OperationsSourceRole,
  signal: AbortSignal,
): Promise<OperationsSourceBinding> {
  if (!operationsSourceRoleSchema.safeParse(role).success)
    operationsInvariant("Unsupported operations source role");
  return operationsTransaction(db, signal, async (tx, bounded) => {
    const installationId = await lockInstallation(tx);
    let reusableSourceId: string | undefined;
    if ((await sourceCount(tx, installationId)) >= OPERATIONS_SOURCE_LIMIT) {
      const [inactive] = await tx
        .select({ id: operationsSources.id })
        .from(operationsSources)
        .where(
          and(
            eq(operationsSources.installationId, installationId),
            eq(operationsSources.active, false),
          ),
        )
        .orderBy(asc(operationsSources.createdAt), asc(operationsSources.id))
        .for("update")
        .limit(1);
      if (!inactive) operationsInvariant("Operations source budget exhausted");
      reusableSourceId = inactive.id;
    }
    bounded.throwIfAborted();
    const generationId = crypto.randomUUID();
    // Re-enroll an inactive slot with a new server generation, rather than
    // cascading a large history deletion or growing source identity forever.
    const values = {
      role,
      currentGenerationId: generationId,
      highestSequence: 0,
      active: true,
      admissionState: "ready" as const,
    };
    const [source] =
      reusableSourceId === undefined
        ? await tx
            .insert(operationsSources)
            .values({ installationId, ...values })
            .returning()
        : await tx
            .update(operationsSources)
            .set(values)
            .where(eq(operationsSources.id, reusableSourceId))
            .returning();
    if (!source) operationsInvariant("Operations source enrollment unavailable");
    return { installationId, sourceId: source.id, generationId };
  });
}

export async function lockedOperationsSource(
  tx: Db,
  binding: OperationsSourceBinding,
  signal: AbortSignal,
) {
  if (!operationsSourceBindingSchema.safeParse(binding).success) return null;
  const installationId = await operationsInstallationId(tx, signal);
  if (installationId !== binding.installationId) return null;
  const [source] = await tx
    .select()
    .from(operationsSources)
    .where(
      and(
        eq(operationsSources.id, binding.sourceId),
        eq(operationsSources.installationId, installationId),
      ),
    )
    .for("update")
    .limit(1);
  signal.throwIfAborted();
  return source ?? null;
}

/** Retiring a generation is durable. Old credentials must be revoked by enrollment
 * integration; these opaque identifiers are not themselves credentials.
 */
export async function rotateOperationsSource(
  db: Db,
  binding: OperationsSourceBinding,
  signal: AbortSignal,
): Promise<OperationsSourceBinding | null> {
  return operationsTransaction(db, signal, async (tx, bounded) => {
    const source = await lockedOperationsSource(tx, binding, bounded);
    if (source === null || !source.active || source.currentGenerationId !== binding.generationId)
      return null;
    const generationId = crypto.randomUUID();
    await tx
      .update(operationsSources)
      .set({ currentGenerationId: generationId, highestSequence: 0 })
      .where(eq(operationsSources.id, source.id));
    return { ...binding, generationId };
  });
}
