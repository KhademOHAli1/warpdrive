import { performance } from "node:perf_hooks";
import type { Pool, PoolClient } from "pg";
import { err, type Result } from "@/types/result";
import {
  beforePrivacyObservationDeadline,
  cancelPrivacyObservationBackend,
  capturePrivacyObservationBackend,
  type PrivacyObservationBackend,
  privacyObservationControlPoolValid,
} from "./privacyObservationCancellation";
import { ownPrivacyObservationPoolErrors } from "./privacyObservationPoolErrors";

const OPERATION_MS = 10_000;
const CLEANUP_MS = 750;
const LOCAL_CLOSE_RESERVE_MS = 50;
type StorageFailure = { ok: false; error: "storage_unavailable" };

type Settled<Value> = { kind: "value"; value: Value } | { kind: "failed"; cause: unknown };
type Stopped = { kind: "stopped" };
type StopReason = { kind: "caller"; reason: unknown } | { kind: "storage" };
type OwnershipState = {
  client: PoolClient | undefined;
  release: "pending" | "held" | "returned" | "discarded";
  closed: boolean;
  stop: StopReason | undefined;
};

// Both dedicated Pools are explicitly supplied. The reader owns authorization and its transaction;
// its lease stays held during independent cancellation/reconciliation and is then discarded.
export async function withPrivacyObservationConnection<R extends Result<unknown, unknown>>(
  pool: Pool,
  controlPool: Pool,
  signal: AbortSignal,
  operation: (client: PoolClient, operationSignal: AbortSignal) => Promise<R>,
): Promise<R | { ok: false; error: "storage_unavailable" }> {
  signal.throwIfAborted();
  const connectMs = pool.options.connectionTimeoutMillis;
  if (
    pool.options.max !== 1 ||
    pool.options.pipeline === true ||
    typeof connectMs !== "number" ||
    !Number.isSafeInteger(connectMs) ||
    connectMs <= 0 ||
    connectMs > OPERATION_MS ||
    pool.ending ||
    pool.ended ||
    pool === controlPool ||
    !privacyObservationControlPoolValid(controlPool)
  )
    return err("storage_unavailable" as const);

  const state: OwnershipState = {
    client: undefined,
    release: "pending",
    closed: false,
    stop: undefined,
  };
  const operationAbort = new AbortController();
  let stopped: (value: Stopped) => void = () => undefined;
  const interruption = new Promise<Stopped>((resolve) => {
    stopped = resolve;
  });
  let closed: () => void = () => undefined;
  const localClose = new Promise<void>((resolve) => {
    closed = resolve;
  });
  let detach: () => void = () => undefined;
  let backend: PrivacyObservationBackend | undefined;
  let cleanupDeadlineAt: number | undefined;

  function finishLocalOwnership() {
    if (state.closed) return;
    state.closed = true;
    detach();
    closed();
  }
  function release(discard: boolean) {
    const client = state.client;
    if (client === undefined || state.release !== "held") return;
    state.release = discard ? "discarded" : "returned";
    try {
      client.release(discard);
      if (!discard) detach();
    } catch {
      state.stop ??= { kind: "storage" };
      state.release = "discarded";
      // An uncertain release must not be retried; its public end promise is owned separately.
      try {
        void client.end().then(finishLocalOwnership, () => undefined);
      } catch {
        /* Cleanup remains uncertain; the local observation deadline still applies. */
      }
    }
  }
  function interrupt(reason: StopReason) {
    cleanupDeadlineAt ??= performance.now() + CLEANUP_MS;
    if (state.stop === undefined || reason.kind === "caller") state.stop = reason;
    if (!operationAbort.signal.aborted)
      operationAbort.abort(reason.kind === "caller" ? reason.reason : undefined);
    stopped({ kind: "stopped" });
  }
  const onCallerAbort = () => interrupt({ kind: "caller", reason: signal.reason });
  const onFailure = () => interrupt({ kind: "storage" });
  const onEnd = () => {
    if (state.release === "held") onFailure();
    finishLocalOwnership();
  };
  const onRemove = (client: PoolClient) => {
    if (client === state.client) onEnd();
  };
  function adopt(client: PoolClient): PoolClient {
    state.client = client;
    state.release = "held";
    let unownPool: () => void = () => undefined;
    detach = () => {
      client.off("error", onFailure);
      client.off("end", onEnd);
      pool.off("remove", onRemove);
      unownPool();
    };
    client.on("error", onFailure);
    client.on("end", onEnd);
    pool.on("remove", onRemove);
    unownPool = ownPrivacyObservationPoolErrors(pool, client, onFailure);
    // Pipelined end/discard can drain active queries; reject before invoking the reader.
    if (client.pipeline === true) interrupt({ kind: "storage" });
    // An abandoned checkout can succeed after the caller has already received its abort reason.
    if (state.stop !== undefined) release(true);
    return client;
  }

  signal.addEventListener("abort", onCallerAbort, { once: true });
  const deadline = setTimeout(() => interrupt({ kind: "storage" }), OPERATION_MS);
  deadline.unref();
  if (signal.aborted) onCallerAbort();
  let outcome: Settled<R | StorageFailure> | Stopped | undefined;
  let pending: Promise<Settled<R | StorageFailure>> | undefined;
  try {
    // Both handlers are attached immediately, including when a checkout settles after the race.
    const acquiring: Promise<Settled<PoolClient>> = Promise.resolve()
      .then(() => {
        operationAbort.signal.throwIfAborted();
        return pool.connect();
      })
      .then(adopt)
      .then(
        (client) => ({ kind: "value", value: client }),
        (cause: unknown) => {
          interrupt({ kind: "storage" });
          return { kind: "failed", cause };
        },
      );
    const acquired = await Promise.race([acquiring, interruption]);
    if (acquired.kind === "value" && state.stop === undefined) {
      pending = Promise.resolve()
        .then(async () => {
          operationAbort.signal.throwIfAborted();
          const captured = await capturePrivacyObservationBackend(
            acquired.value,
            operationAbort.signal,
          );
          if (!captured.ok) {
            interrupt({ kind: "storage" });
            return captured;
          }
          backend = captured.value;
          operationAbort.signal.throwIfAborted();
          return operation(acquired.value, operationAbort.signal);
        })
        .then(
          (value) => ({ kind: "value", value }),
          (cause: unknown) => ({ kind: "failed", cause }),
        );
      outcome = await Promise.race([pending, interruption]);
    } else {
      if (acquired.kind === "failed") interrupt({ kind: "storage" });
      outcome = { kind: "stopped" };
    }
  } finally {
    clearTimeout(deadline);
    const discard = state.stop !== undefined || outcome?.kind !== "value";
    if (discard) {
      cleanupDeadlineAt ??= performance.now() + CLEANUP_MS;
      const reconciliationDeadline = cleanupDeadlineAt - LOCAL_CLOSE_RESERVE_MS;
      if (backend !== undefined && pending !== undefined) {
        const acknowledged = await cancelPrivacyObservationBackend(
          controlPool,
          backend,
          pending,
          reconciliationDeadline,
        );
        if (!acknowledged) state.stop ??= { kind: "storage" };
      }
      if (pending !== undefined) {
        const settled = await beforePrivacyObservationDeadline(pending, reconciliationDeadline);
        if (settled.kind !== "value") state.stop ??= { kind: "storage" };
      }
    }
    release(discard);
    if (state.release === "discarded" && !state.closed) {
      const observed = await beforePrivacyObservationDeadline(
        localClose,
        cleanupDeadlineAt ?? performance.now(),
      );
      if (observed.kind !== "value") state.stop ??= { kind: "storage" };
      // The critical end/error owners remain attached after this deadline until actual local close.
    }
    signal.removeEventListener("abort", onCallerAbort);
  }
  if (signal.aborted) onCallerAbort();
  if (state.stop?.kind === "caller") throw state.stop.reason;
  if (state.stop !== undefined || outcome?.kind !== "value") {
    if (state.stop === undefined && outcome?.kind === "failed") throw outcome.cause;
    return err("storage_unavailable" as const);
  }
  // Native ACK is measured independently; local end/remove only releases transport ownership.
  return outcome.value;
}
