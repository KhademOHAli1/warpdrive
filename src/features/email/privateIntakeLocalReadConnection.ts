import { DrizzleQueryError } from "drizzle-orm";
import type { Pool, PoolClient } from "pg";
import { AppError, ERROR_IDS } from "@/constants/errorIds";

export const PRIVATE_READ_CLEANUP_MS = 1500;
const CHECKOUT_MS = 1500;

export interface Backend {
  pid: number;
  started: string;
  database_oid: string;
  database_name: string;
  server_started: string;
  address: string | null;
  port: number | null;
}

export type Outcome<Value> = { ok: true; value: Value } | { ok: false; error: unknown };
export const observe = <Value>(pending: Promise<Value>): Promise<Outcome<Value>> =>
  pending.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
export function uncertain(phase: string, cause?: unknown) {
  const error = new AppError(
    ERROR_IDS.DB_WRITE_FAILED,
    "Private read transaction cleanup is unconfirmed",
    { phase },
  );
  Object.defineProperty(error, "cause", { value: cause, configurable: true, writable: true });
  return error;
}

export function retainCleanup(error: unknown, failure: unknown) {
  if (error instanceof Error && Object.isExtensible(error)) {
    const previous: unknown = Object.getOwnPropertyDescriptor(error, "cleanupFailure")?.value;
    Object.defineProperty(error, "cleanupFailure", {
      value:
        previous === undefined
          ? failure
          : new AggregateError([previous, failure], "Private read cleanup uncertain"),
      configurable: true,
    });
  }
}

// This late completion must survive the caller's cleanup deadline. Pool error
// forwarding is installed only after both actual end and native work settle.
export function retirePrivateReadClient(
  client: PoolClient,
  ended: Promise<void>,
  work: Promise<unknown>,
  account: () => void,
) {
  const state: { failure: { error: unknown } | undefined } = { failure: undefined };
  let pending: Promise<Outcome<void>>;
  try {
    pending = observe(client.end());
  } catch (error) {
    const failed: Outcome<void> = { ok: false, error };
    pending = Promise.resolve(failed);
  }
  const close = pending.then((outcome) => {
    if (!outcome.ok) state.failure = { error: outcome.error };
    return outcome;
  });
  const completion = observe(
    (async () => {
      const [outcome] = await Promise.all([close, ended, observe(work)]);
      try {
        account();
      } catch (error) {
        state.failure = { error };
        throw error;
      }
      if (!outcome.ok) throw outcome.error;
    })(),
  );
  return { completion, failure: () => state.failure };
}

export async function bounded<Value>(pending: Promise<Value>, signal: AbortSignal, phase: string) {
  const observed = observe(pending);
  if (signal.aborted) throw uncertain(phase, signal.reason);
  let abort = () => {};
  const stopped = new Promise<never>((_resolve, reject) => {
    abort = () => reject(uncertain(phase, signal.reason));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
  try {
    const outcome = await Promise.race([observed, stopped]);
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

// Public connect cannot dequeue a waiter. Observe and release a late grant,
// but never label an outstanding checkout as completed native cancellation.
function requireActiveCheckout(signal: AbortSignal, phase: string) {
  if (signal.aborted) throw uncertain(phase, signal.reason);
}

export async function checkout(pool: Pool, signal: AbortSignal, phase: string) {
  const checkoutSignal = AbortSignal.any([signal, AbortSignal.timeout(CHECKOUT_MS)]);
  requireActiveCheckout(checkoutSignal, phase);
  const state: { abandoned: boolean; granted: PoolClient | undefined } = {
    abandoned: false,
    granted: undefined,
  };
  const pending = pool.connect().then((client) => {
    state.granted = client;
    if (state.abandoned) {
      state.granted = undefined;
      client.release();
    }
    return client;
  });
  try {
    const client = await bounded(pending, checkoutSignal, phase);
    requireActiveCheckout(checkoutSignal, phase);
    state.granted = undefined;
    return client;
  } catch (error) {
    state.abandoned = true;
    state.granted?.release();
    state.granted = undefined;
    throw error;
  }
}

function requireLiveObserver(state: { transport: Error | undefined; ended: boolean }) {
  if (state.transport !== undefined || state.ended)
    throw uncertain("observer-transport", state.transport);
}

async function waitForBackendCheck(signal: AbortSignal) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await bounded(
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 10);
      }),
      signal,
      "backend-observation",
    );
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function confirmBackendGone(pool: Pool, backend: Backend, signal: AbortSignal) {
  const observer = await checkout(pool, signal, "observer-checkout");
  const state: {
    destroy: boolean;
    transport: Error | undefined;
    ended: boolean;
    work: Promise<unknown>;
  } = {
    destroy: true,
    transport: undefined,
    ended: false,
    work: Promise.resolve(),
  };
  let end = () => {};
  const endObserved = new Promise<void>((resolve) => {
    end = resolve;
  });
  const onError = (error: Error) => {
    if (state.transport === undefined) state.transport = error;
  };
  const onEnd = () => {
    state.ended = true;
    observer.removeListener("error", onError);
    end();
  };
  observer.on("error", onError);
  observer.once("end", onEnd);
  const primary = await observe(
    (async () => {
      if (observer.pipeline !== false || observer.getTransactionStatus() !== "I")
        throw uncertain("observer-capability");
      while (!signal.aborted) {
        requireLiveObserver(state);
        const query = observer.query<{
          same_server: boolean;
          alive: boolean;
          pid_present: boolean;
        }>(
          `SELECT pg_catalog.current_database()=$4 AND
          (SELECT oid::text FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database())=$3 AND
          extract(epoch FROM pg_catalog.pg_postmaster_start_time())::text=$5 AND
          pg_catalog.inet_server_addr()::text IS NOT DISTINCT FROM $6::text AND
          pg_catalog.inet_server_port() IS NOT DISTINCT FROM $7::integer AS same_server,
          EXISTS(SELECT 1 FROM pg_catalog.pg_stat_activity WHERE pid=$1
            AND extract(epoch FROM backend_start)=$2::numeric
            AND datid=$3::oid AND datname=$4) AS alive,
          EXISTS(SELECT 1 FROM pg_catalog.pg_stat_activity WHERE pid=$1) AS pid_present`,
          [
            backend.pid,
            backend.started,
            backend.database_oid,
            backend.database_name,
            backend.server_started,
            backend.address,
            backend.port,
          ],
        );
        state.work = observe(query);
        const result = await bounded(query, signal, "backend-observation");
        const row = result.rows[0];
        requireLiveObserver(state);
        if (row?.same_server !== true) throw uncertain("server-identity");
        // A reused/hidden PID remains uncertain rather than falsely proving absence.
        if (!row.alive && !row.pid_present) {
          state.destroy = false;
          return;
        }
        await waitForBackendCheck(signal);
      }
      throw uncertain("backend-observation");
    })(),
  );
  // Capture cleanup independently. Its failure cannot replace the primary error.
  const cleaned = await observe(
    (async () => {
      if (state.destroy) {
        const retiring = retirePrivateReadClient(observer, endObserved, state.work, () =>
          observer.release(true),
        );
        const result = await observe(bounded(retiring.completion, signal, "observer-retirement"));
        const cleanup = !result.ok
          ? { error: result.error }
          : !result.value.ok
            ? { error: result.value.error }
            : undefined;
        if (cleanup !== undefined)
          throw uncertain("observer-retirement", retiring.failure()?.error ?? cleanup.error);
      } else {
        observer.release();
        observer.removeListener("error", onError);
        observer.removeListener("end", onEnd);
      }
    })(),
  );
  const outcome: Outcome<void> =
    state.transport === undefined
      ? primary
      : { ok: false, error: uncertain("observer-transport", state.transport) };
  if (!outcome.ok) {
    if (!cleaned.ok) retainCleanup(outcome.error, cleaned.error);
    throw outcome.error;
  }
  if (!cleaned.ok) throw cleaned.error;
}

export function ownedTermination(error: unknown, reason: unknown) {
  if (error === reason) return true;
  const cause = error instanceof DrizzleQueryError ? error.cause : error;
  return cause instanceof Error && !("code" in cause) && cause.message === "Connection terminated";
}
