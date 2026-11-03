import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import * as schema from "@/db/schema";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import {
  type Backend,
  bounded,
  confirmBackendGone,
  type Outcome,
  observe,
  ownedTermination,
  PRIVATE_READ_CLEANUP_MS,
  retainCleanup,
  uncertain,
} from "./privateIntakeLocalReadConnection";
import type { PrivateReadLifecycle } from "./privateIntakeLocalReadLifecycle";

const CONNECTION_CHECK_MS = 100;
const COMMIT_RECEIPT_MS = 1500;

async function receiveCommit(life: PrivateReadLifecycle) {
  const { client, state } = life;
  const receipt = observe(client.query("COMMIT"));
  // Accounting must await the actual driver receipt, even after our caller budget expires.
  state.cleanupWork = receipt;
  let outcome: Awaited<typeof receipt>;
  try {
    outcome = await bounded(receipt, AbortSignal.timeout(COMMIT_RECEIPT_MS), "commit-receipt");
  } catch (error) {
    // Only our independent deadline rejects this observed promise. A server error
    // remains the original value below, so a late caller abort cannot replace it.
    state.commitUncertain = true;
    const failure = state.transport ?? error;
    if (failure !== error) retainCleanup(failure, error);
    life.destroy();
    throw failure;
  }
  if (!outcome.ok) throw outcome.error;
}

async function executeTransaction<Value>(
  life: PrivateReadLifecycle,
  work: (tx: DbOrTx) => Promise<Value>,
) {
  const { client, signal, state } = life;
  try {
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    state.begun = true;
    signal.throwIfAborted();
    const identity = await client.query<Backend>(`SELECT pid,
          extract(epoch FROM backend_start)::text AS started, datid::text AS database_oid,
          datname AS database_name, extract(epoch FROM pg_catalog.pg_postmaster_start_time())::text AS server_started,
          pg_catalog.inet_server_addr()::text AS address, pg_catalog.inet_server_port() AS port
          FROM pg_catalog.pg_stat_activity WHERE pid=pg_catalog.pg_backend_pid()`);
    state.backend = identity.rows[0];
    if (state.backend === undefined) throw uncertain("backend-identity");
    signal.throwIfAborted();
    await client.query(
      `SELECT pg_catalog.set_config('client_connection_check_interval',
          CASE WHEN setting::integer>0 THEN LEAST(setting::integer,$1)::text ELSE $1::text END,true)
          FROM pg_catalog.pg_settings WHERE name='client_connection_check_interval'`,
      [CONNECTION_CHECK_MS],
    );
    signal.throwIfAborted();
    const value = await work(drizzle(client, { schema }));
    if (client.getTransactionStatus() !== "T")
      throw new AppError(ERROR_IDS.DB_INVARIANT, "Private read transaction ended before commit");
    // No await may separate this abort check/disarm cutoff from COMMIT dispatch.
    signal.throwIfAborted();
    life.disarm();
    await receiveCommit(life);
    state.begun = false;
    return value;
  } catch (error) {
    state.failure = { error };
    throw error;
  }
}

function cancelledFailure(life: PrivateReadLifecycle, error: unknown) {
  const { signal, state } = life;
  const failure = state.failure;
  if (failure !== undefined && !ownedTermination(failure.error, signal.reason)) {
    if (error !== failure.error) retainCleanup(failure.error, error);
    return failure.error;
  }
  const transport = state.transport;
  if (transport !== undefined) {
    if (error !== transport) retainCleanup(transport, error);
    return transport;
  }
  if (error === signal.reason) return error;
  const phase =
    error instanceof AppError && typeof error.context?.phase === "string"
      ? error.context.phase
      : "retirement";
  const lateFailure = state.closing?.failure();
  const cause =
    lateFailure === undefined
      ? error
      : new AggregateError([lateFailure.error, error], "Private read retirement uncertain");
  return uncertain(
    phase,
    new AggregateError([signal.reason, cause], "Private read cleanup uncertain"),
  );
}

async function settleCancellation<Value>(
  life: PrivateReadLifecycle,
  pool: Pool,
  completed: Promise<Outcome<Value>>,
): Promise<never> {
  const { signal, state } = life;
  try {
    const { cleanup, closing } = state;
    if (cleanup === undefined || closing === undefined)
      throw uncertain("retirement", signal.reason);
    const [outcome, accounted] = await bounded(
      Promise.all([completed, closing.completion]),
      cleanup,
      "retirement",
    );
    if (!accounted.ok) throw uncertain("retirement", accounted.error);
    const backend = state.backend;
    if (backend === undefined) throw uncertain("backend-identity");
    await confirmBackendGone(pool, backend, cleanup);
    if (!outcome.ok && !ownedTermination(outcome.error, signal.reason)) throw outcome.error;
    if (state.transport !== undefined || state.endedBeforeRetirement)
      throw state.transport ?? uncertain("transport");
    throw signal.reason;
  } catch (error) {
    throw cancelledFailure(life, error);
  }
}

async function retireUncertainCommit(life: PrivateReadLifecycle, original: unknown) {
  const retiring = life.destroy();
  const result = await observe(
    bounded(retiring.completion, AbortSignal.timeout(PRIVATE_READ_CLEANUP_MS), "commit-retirement"),
  );
  if (!result.ok) retainCleanup(original, result.error);
  else if (!result.value.ok)
    retainCleanup(original, uncertain("commit-retirement", result.value.error));
}

async function rollbackFailure(life: PrivateReadLifecycle, original: unknown) {
  const { state } = life;
  life.disarm();
  if (state.commitUncertain) return retireUncertainCommit(life, original);
  if (!state.begun) return;
  const signal = AbortSignal.timeout(PRIVATE_READ_CLEANUP_MS);
  try {
    const rollback = life.client.query("ROLLBACK");
    state.cleanupWork = observe(rollback);
    await bounded(rollback, signal, "rollback");
    state.begun = false;
  } catch (error) {
    retainCleanup(original, uncertain("rollback", error));
    const retiring = life.destroy();
    const result = await observe(bounded(retiring.completion, signal, "rollback-retirement"));
    if (!result.ok) retainCleanup(original, uncertain("rollback-retirement", result.error));
    else if (!result.value.ok)
      retainCleanup(original, uncertain("rollback-retirement", result.value.error));
  }
}

export async function performPrivateRead<Value>(
  life: PrivateReadLifecycle,
  pool: Pool,
  work: (tx: DbOrTx) => Promise<Value>,
): Promise<Value> {
  const { client, signal, state } = life;
  if (client.pipeline !== false || client.getTransactionStatus() !== "I")
    throw new AppError(
      ERROR_IDS.DB_INVARIANT,
      "Private read requires an idle non-pipelined client",
    );
  signal.throwIfAborted();
  life.arm();
  state.workStarted = true;
  const completed = observe(executeTransaction(life, work));
  void completed.then(life.completeWork);
  await Promise.race([completed, life.retirementStarted]);
  if (state.retired) return settleCancellation(life, pool, completed);
  const outcome = await completed;
  if (outcome.ok) return outcome.value;
  await rollbackFailure(life, outcome.error);
  throw outcome.error;
}

export async function cleanupPrivateRead(life: PrivateReadLifecycle) {
  const { state } = life;
  life.disarm();
  if (!state.workStarted) life.completeWork();
  if (!state.released && !state.destroyed) {
    if (life.client.getTransactionStatus() === "I") life.release();
    else {
      const retiring = life.destroy();
      const result = await bounded(
        retiring.completion,
        AbortSignal.timeout(PRIVATE_READ_CLEANUP_MS),
        "release",
      );
      if (!result.ok) throw result.error;
    }
  }
  if (!state.destroyed) life.detach();
}
