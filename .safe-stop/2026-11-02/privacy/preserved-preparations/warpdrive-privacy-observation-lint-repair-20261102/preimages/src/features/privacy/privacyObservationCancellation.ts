import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { z } from "zod";
import { err, ok } from "@/types/result";
import { ownPrivacyObservationPoolErrors } from "./privacyObservationPoolErrors";

const CONTROL_CONNECT_MS = 100;
const CONTROL_QUERY_MS = 100;
const backendSchema = z.strictObject({
  pid: z.number().int().positive(),
  backendStart: z.string().min(1).max(100),
  backendEpoch: z.string().min(1).max(100),
  database: z.string().min(1).max(200),
  user: z.string().min(1).max(200),
  instanceEpoch: z.string().min(1).max(100),
});
export type PrivacyObservationBackend = z.infer<typeof backendSchema>;
type Bounded<Value> = { kind: "value"; value: Value } | { kind: "failed" } | { kind: "deadline" };

function finiteBudget(value: unknown, maximum: number): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= maximum;
}

export function privacyObservationControlPoolValid(pool: Pool): boolean {
  return (
    pool.options.max === 1 &&
    pool.options.pipeline !== true &&
    !pool.ending &&
    !pool.ended &&
    finiteBudget(pool.options.connectionTimeoutMillis, CONTROL_CONNECT_MS) &&
    finiteBudget(pool.options.statement_timeout, CONTROL_QUERY_MS) &&
    finiteBudget(pool.options.query_timeout, CONTROL_QUERY_MS)
  );
}

export async function beforePrivacyObservationDeadline<Value>(
  pending: Promise<Value>,
  deadlineAt: number,
): Promise<Bounded<Value>> {
  // Attach to the full operation immediately, including a late checkout/adoption rejection.
  const settled: Promise<Bounded<Value>> = pending.then(
    (value) => ({ kind: "value", value }),
    () => ({ kind: "failed" }),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Bounded<Value>>((resolve) => {
    timer = setTimeout(
      () => resolve({ kind: "deadline" }),
      Math.max(0, deadlineAt - performance.now()),
    );
    timer.unref();
  });
  try {
    return await Promise.race([settled, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function capturePrivacyObservationBackend(client: PoolClient, signal: AbortSignal) {
  signal.throwIfAborted();
  try {
    const result = await client.query<PrivacyObservationBackend>(
      `SELECT a.pid, a.backend_start::text AS "backendStart",
        extract(epoch FROM a.backend_start)::text AS "backendEpoch", current_database() AS "database",
        current_user AS "user", extract(epoch FROM pg_postmaster_start_time())::text AS "instanceEpoch"
       FROM pg_stat_activity a WHERE a.pid=pg_backend_pid()
         AND a.datname=current_database() AND a.usename=current_user`,
    );
    signal.throwIfAborted();
    const parsed = backendSchema.safeParse(result.rows.length === 1 ? result.rows[0] : undefined);
    return parsed.success ? ok(parsed.data) : err("storage_unavailable" as const);
  } catch {
    signal.throwIfAborted();
    return err("storage_unavailable" as const);
  }
}

const acknowledgementSchema = z.strictObject({
  contextMatches: z.boolean(),
  acknowledged: z.boolean(),
});
const cancellationSchema = z.array(z.strictObject({ cancelled: z.boolean() })).max(1);

// SQL identity checks are not a secret-backed protocol cancellation guarantee.
// Native epoch text preserves microseconds across rendering settings; cancel/local close is not ACK.
export async function cancelPrivacyObservationBackend(
  pool: Pool,
  backend: PrivacyObservationBackend,
  completion: Promise<unknown>,
  deadlineAt: number,
): Promise<boolean> {
  if (performance.now() >= deadlineAt || !privacyObservationControlPoolValid(pool)) return false;
  const completionState = { settled: false };
  void completion.then(
    () => {
      completionState.settled = true;
    },
    () => {
      completionState.settled = true;
    },
  );
  let client: PoolClient | undefined;
  let held = false;
  let uncertain = false;
  let queryPending = false;
  let detached = false;
  let detach: () => void = () => undefined;
  const failed = () => {
    uncertain = true;
  };
  const ended = () => {
    failed();
    detach();
  };
  const removed = (removedClient: PoolClient) => {
    if (removedClient === client) ended();
  };
  function release(discard: boolean) {
    if (client === undefined || !held) return;
    held = false;
    try {
      client.release(discard);
      if (!discard) detach();
    } catch {
      uncertain = true;
      try {
        void client.end().then(detach, () => undefined);
      } catch {
        /* Remain uncertain. */
      }
    }
  }
  function adopt(acquired: PoolClient) {
    client = acquired;
    held = true;
    let unown: () => void = () => undefined;
    detach = () => {
      if (detached) return;
      detached = true;
      acquired.off("error", failed);
      acquired.off("end", ended);
      pool.off("remove", removed);
      unown();
    };
    acquired.on("error", failed);
    acquired.on("end", ended);
    pool.on("remove", removed);
    unown = ownPrivacyObservationPoolErrors(pool, acquired, failed);
    if (acquired.pipeline === true || performance.now() >= deadlineAt) {
      uncertain = true;
      release(true);
    }
    return acquired;
  }
  async function query<Row extends QueryResultRow>(
    text: string,
    values: readonly (string | number)[],
  ) {
    const selected = client;
    if (selected === undefined || uncertain || performance.now() >= deadlineAt) return null;
    queryPending = true;
    const pending = Promise.resolve()
      .then(() => {
        if (uncertain || performance.now() >= deadlineAt) return undefined;
        return selected.query<Row>(text, [...values]);
      })
      .then(
        (value) => {
          queryPending = false;
          return value;
        },
        (cause: unknown) => {
          queryPending = false;
          throw cause;
        },
      );
    const result = await beforePrivacyObservationDeadline(pending, deadlineAt);
    if (result.kind !== "value" || result.value === undefined || uncertain) {
      uncertain = true;
      return null;
    }
    return result.value;
  }
  const values = [
    backend.pid,
    backend.backendEpoch,
    backend.database,
    backend.user,
    backend.instanceEpoch,
  ];
  async function acknowledged() {
    const result = await query<{ contextMatches: boolean; acknowledged: boolean }>(
      `SELECT current_database()=$3 AND current_user=$4 AND pg_backend_pid()<>$1
        AND extract(epoch FROM pg_postmaster_start_time())::text=$5
        AND (SELECT setting::integer BETWEEN 1 AND ${CONTROL_QUERY_MS} FROM pg_settings
          WHERE name='statement_timeout') AS "contextMatches",
        NOT EXISTS (SELECT 1 FROM pg_stat_activity a WHERE a.pid=$1 AND extract(epoch FROM a.backend_start)::text=$2
          AND a.datname=$3 AND a.usename=$4 AND (a.state IS DISTINCT FROM 'idle'
            OR a.xact_start IS NOT NULL OR EXISTS (SELECT 1 FROM pg_locks WHERE pid=a.pid))) AS acknowledged`,
      values,
    );
    const parsed = acknowledgementSchema.safeParse(
      result?.rows.length === 1 ? result.rows[0] : undefined,
    );
    return parsed.success && parsed.data.contextMatches ? parsed.data.acknowledged : null;
  }
  let ack = false;
  try {
    const acquisition = Promise.resolve()
      .then(() => (performance.now() < deadlineAt ? pool.connect() : undefined))
      .then((acquired) => (acquired === undefined ? undefined : adopt(acquired)))
      .catch(() => {
        uncertain = true;
        release(true);
        return undefined;
      });
    const acquired = await beforePrivacyObservationDeadline(acquisition, deadlineAt);
    if (acquired.kind !== "value" || acquired.value === undefined || uncertain) return false;
    let cancelSent = false;
    while (performance.now() < deadlineAt) {
      // A pre-completion idle sample cannot retire work already queued on the reader socket.
      const completedBeforeSample = completionState.settled;
      const observed = await acknowledged();
      if (observed === null) return false;
      if (observed && completedBeforeSample) {
        ack = true;
        return true;
      }
      if (!observed && !cancelSent) {
        const cancelled = await query<{ cancelled: boolean }>(
          `SELECT pg_cancel_backend(a.pid) AS cancelled FROM pg_stat_activity a
           WHERE a.pid=$1 AND extract(epoch FROM a.backend_start)::text=$2 AND a.datname=$3 AND a.usename=$4
             AND current_database()=$3 AND current_user=$4 AND extract(epoch FROM pg_postmaster_start_time())::text=$5
             AND a.pid<>pg_backend_pid() AND a.state='active'`,
          values,
        );
        const parsed = cancellationSchema.safeParse(cancelled?.rows);
        if (!parsed.success) return false;
        // Once sent, leave rollback alone and require completion plus a fresh native ACK sample.
        cancelSent = parsed.data[0]?.cancelled === true;
      }
      await delay(Math.min(10, Math.max(0, deadlineAt - performance.now())), undefined, {
        ref: false,
      });
    }
    return false;
  } finally {
    release(!ack || uncertain || queryPending);
    // An uncertain late query/client retains its error owners until its actual end/remove event.
  }
}
