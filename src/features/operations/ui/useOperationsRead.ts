"use client";
import { useEffect, useRef, useState } from "react";
import { isOperationsAccessDenied, type OperationsReadSlot } from "./readCycle";

export const OPERATIONS_POLL_MS = 60_000;
export const OPERATIONS_READ_DEADLINE_MS = 15_000;
type Failure = "unavailable" | "timeout" | null;
type Reader<T> = (signal: AbortSignal, denied: () => void) => Promise<T>;
interface Snapshot<T> {
  key: string;
  reader: Reader<T>;
  data: T | undefined;
  startedAt: number;
  busy: boolean;
  denied: boolean;
  failure: Failure;
}

export function useOperationsRead<T>(key: string, read: Reader<T>, slot: OperationsReadSlot) {
  const [snapshot, setSnapshot] = useState<Snapshot<T>>({
    key,
    reader: read,
    data: undefined,
    startedAt: 0,
    busy: false,
    denied: false,
    failure: null,
  });
  const [now, setNow] = useState(0);
  const refresh = useRef<() => void>(() => {});
  useEffect(() => {
    let alive = true,
      denied = false,
      lastStarted = Number.NEGATIVE_INFINITY;
    let poll: ReturnType<typeof setTimeout> | null = null;
    let tick: ReturnType<typeof setInterval> | null = null;
    let deadline: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;
    let checkDeadline: (() => void) | null = null;
    const visible = () => document.visibilityState !== "hidden";
    const isAlive = (): boolean => alive;
    const isDenied = (): boolean => denied;
    const isActive = () => isAlive() && !isDenied();
    const clearPoll = () => {
      if (poll !== null) clearTimeout(poll);
      poll = null;
    };
    const clearDeadline = () => {
      if (deadline !== null) clearTimeout(deadline);
      deadline = null;
    };
    const deny = () => {
      if (!isAlive()) return;
      denied = true;
      controller?.abort();
      clearPoll();
      clearDeadline();
      setSnapshot({
        key,
        reader: read,
        data: undefined,
        startedAt: 0,
        busy: slot.isBusy(),
        denied: true,
        failure: null,
      });
    };
    const schedule = () => {
      clearPoll();
      if (!isActive() || !visible() || slot.isBusy()) return;
      poll = setTimeout(
        () => {
          void run();
        },
        Math.max(0, OPERATIONS_POLL_MS - (performance.now() - lastStarted)),
      );
    };
    async function run() {
      if (!isActive() || !visible() || slot.isBusy()) return;
      clearPoll();
      const request = new AbortController();
      controller = request;
      const startedAt = performance.now();
      lastStarted = startedAt;
      let expired = false;
      const didExpire = (): boolean => expired;
      const ownsRequest = () => isActive() && controller === request;
      const deadlinePassed = () => {
        const current = performance.now();
        return (
          didExpire() ||
          !Number.isFinite(current) ||
          current < startedAt ||
          current - startedAt >= OPERATIONS_READ_DEADLINE_MS
        );
      };
      const promise = slot.run(() => {
        request.signal.throwIfAborted();
        return read(request.signal, deny);
      });
      if (promise === null) return;
      setSnapshot((previous) => ({
        key,
        reader: read,
        data: previous.key === key && previous.reader === read ? previous.data : undefined,
        startedAt: previous.startedAt,
        busy: true,
        denied: false,
        failure: previous.key === key ? previous.failure : null,
      }));
      const expire = () => {
        if (!ownsRequest()) return;
        expired = true;
        request.abort();
        setSnapshot((previous) => ({ ...previous, busy: true, failure: "timeout" }));
      };
      checkDeadline = () => {
        if (deadlinePassed()) expire();
      };
      deadline = setTimeout(expire, OPERATIONS_READ_DEADLINE_MS);
      try {
        const data = await promise;
        if (!ownsRequest()) return;
        // Browser timers may be throttled; an elapsed deadline rejects late success even
        // when its timer callback has not run. Actual transport settlement still owns the slot.
        if (deadlinePassed()) {
          expire();
          return;
        }
        setNow(performance.now());
        setSnapshot({
          key,
          reader: read,
          data,
          startedAt,
          busy: false,
          denied: false,
          failure: null,
        });
      } catch (error) {
        if (!isActive()) return;
        if (isOperationsAccessDenied(error)) {
          deny();
          return;
        }
        if (deadlinePassed()) {
          expire();
          return;
        }
        setSnapshot((previous) => ({
          ...previous,
          busy: false,
          failure: didExpire() ? "timeout" : "unavailable",
        }));
      } finally {
        clearDeadline();
        controller = null;
        checkDeadline = null;
        if (isAlive()) {
          setSnapshot((previous) => ({ ...previous, busy: slot.isBusy() }));
          schedule();
        }
      }
    }
    const unsubscribe = slot.subscribe(() => {
      if (!isAlive()) return;
      setSnapshot((previous) => ({ ...previous, busy: slot.isBusy() }));
      schedule();
    });
    const visibility = () => {
      clearPoll();
      if (tick !== null) clearInterval(tick);
      tick = null;
      if (!visible()) return;
      checkDeadline?.();
      setNow(performance.now());
      tick = setInterval(() => {
        checkDeadline?.();
        setNow(performance.now());
      }, 1000);
      schedule();
    };
    refresh.current = () => {
      if (slot.isBusy()) return;
      denied = false;
      setSnapshot((previous) => ({
        ...previous,
        denied: false,
        data: previous.denied ? undefined : previous.data,
      }));
      void run();
    };
    document.addEventListener("visibilitychange", visibility);
    const start = setTimeout(() => {
      visibility();
      void run();
    }, 0);
    return () => {
      alive = false;
      clearTimeout(start);
      unsubscribe();
      controller?.abort();
      clearDeadline();
      clearPoll();
      if (tick !== null) clearInterval(tick);
      document.removeEventListener("visibilitychange", visibility);
      refresh.current = () => {};
    };
  }, [key, read, slot]);
  const current =
    snapshot.key === key && snapshot.reader === read
      ? snapshot
      : {
          key,
          reader: read,
          data: undefined,
          startedAt: 0,
          busy: slot.isBusy(),
          denied: false,
          failure: null,
        };
  return { ...current, now, refresh: () => refresh.current() };
}
