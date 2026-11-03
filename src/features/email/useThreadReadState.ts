"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RouterOutputs } from "@/lib/trpc-client";
import {
  type PendingReadIntent,
  type ReadIntentOutcome,
  refreshThreadReadIntent,
  runThreadReadIntent,
} from "./threadReadIntent.client";

type FreshThread = RouterOutputs["email"]["thread"]["get"];
interface ReadFrame {
  threadId: string;
  canMarkRead: boolean;
}
interface ReadStatus {
  frame: ReadFrame;
  kind: "pending" | "uncertain" | "failed" | "refreshing";
}
interface ReadRequest {
  frame: ReadFrame;
  promise: Promise<ReadIntentOutcome>;
  handled: boolean;
}
interface RefreshRequest {
  frame: ReadFrame;
  controller: AbortController;
}
interface AutomaticProgress {
  threadId: string;
  phase: "unavailable" | "pending" | "settled";
}

export function useThreadReadState({
  threadId,
  canMarkRead,
  readFresh,
  cacheFresh,
  onConfirmed,
}: {
  threadId: string;
  canMarkRead: boolean;
  readFresh: (signal: AbortSignal) => Promise<FreshThread>;
  cacheFresh: (data: FreshThread) => void;
  onConfirmed: () => void;
}) {
  const frame = useMemo<ReadFrame>(() => ({ threadId, canMarkRead }), [threadId, canMarkRead]);
  const current = useRef(frame);
  const mounted = useRef(false);
  const confirmed = useRef(onConfirmed);
  const automatic = useRef<ReadRequest | null>(null);
  const recovery = useRef<RefreshRequest | null>(null);
  const unconfirmed = useRef<{ frame: ReadFrame; intent: PendingReadIntent } | null>(null);
  const gate = useRef<{ frame: ReadFrame; busy: boolean; locked: boolean } | null>(null);
  const [status, setStatus] = useState<ReadStatus | null>(null);
  const [automaticProgress, setAutomaticProgress] = useState<AutomaticProgress>(() => ({
    threadId,
    phase: canMarkRead ? "pending" : "unavailable",
  }));
  // Adjust loading with its input identity before committing the reader.
  if (automaticProgress.threadId !== threadId) {
    setAutomaticProgress({ threadId, phase: canMarkRead ? "pending" : "unavailable" });
  } else if (canMarkRead && automaticProgress.phase === "unavailable") {
    setAutomaticProgress({ threadId, phase: "pending" });
  }
  const automaticPending =
    canMarkRead &&
    (automaticProgress.threadId !== threadId || automaticProgress.phase !== "settled");
  useLayoutEffect(() => {
    current.current = frame;
    mounted.current = true;
    return () => {
      mounted.current = false;
      const pending = recovery.current;
      if (pending?.frame === frame) pending.controller.abort();
    };
  }, [frame]);
  useLayoutEffect(() => {
    confirmed.current = onConfirmed;
  }, [onConfirmed]);
  const isCurrent = useCallback(
    (candidate: ReadFrame) => mounted.current && current.current === candidate,
    [],
  );
  const isCurrentThread = useCallback(
    (candidate: ReadFrame) => mounted.current && current.current.threadId === candidate.threadId,
    [],
  );
  const finish = useCallback(
    (candidate: ReadFrame, result: ReadIntentOutcome, manual: boolean) => {
      if (!isCurrentThread(candidate)) return;
      const live = current.current;
      if (!manual) setAutomaticProgress({ threadId: live.threadId, phase: "settled" });
      const uncertain = result.kind === "uncertain";
      unconfirmed.current = uncertain ? { frame: live, intent: result.intent } : null;
      gate.current = { frame: live, busy: false, locked: uncertain };
      setStatus(
        uncertain
          ? { frame: live, kind: "uncertain" }
          : result.kind === "applied"
            ? null
            : { frame: live, kind: "failed" },
      );
      if (result.kind === "applied" && live.canMarkRead) confirmed.current();
    },
    [isCurrentThread],
  );

  useEffect(() => {
    if (!frame.canMarkRead) {
      if (automatic.current?.frame.threadId !== frame.threadId) automatic.current = null;
      return;
    }
    let request = automatic.current;
    if (request?.frame.threadId === frame.threadId) {
      if (request.handled) return;
    } else {
      request = {
        frame,
        handled: false,
        promise: runThreadReadIntent(frame.threadId, true, () => isCurrent(frame)),
      };
      automatic.current = request;
    }
    gate.current = { frame, busy: true, locked: false };
    const pending = request;
    let disposed = false;
    void pending.promise.then((result) => {
      if (disposed || pending.handled || !isCurrent(frame)) return;
      pending.handled = true;
      finish(frame, result, false);
    });
    return () => {
      disposed = true;
    };
  }, [frame, finish, isCurrent]);

  async function markUnread(): Promise<void> {
    if (!frame.canMarkRead || !isCurrent(frame) || automaticPending) return;
    const prior = gate.current;
    if (prior?.frame.threadId === frame.threadId && (prior.busy || prior.locked)) return;
    gate.current = { frame, busy: true, locked: false };
    setStatus({ frame, kind: "pending" });
    const result = await runThreadReadIntent(frame.threadId, false, () => isCurrent(frame));
    finish(frame, result, true);
  }

  async function refresh(): Promise<void> {
    const pending = unconfirmed.current;
    const prior = gate.current;
    if (
      !isCurrent(frame) ||
      pending?.frame.threadId !== frame.threadId ||
      prior?.frame.threadId !== frame.threadId ||
      !prior.locked ||
      prior.busy
    )
      return;
    gate.current = { frame, busy: true, locked: true };
    setStatus({ frame, kind: "refreshing" });
    const request = { frame, controller: new AbortController() };
    recovery.current = request;
    const result = await refreshThreadReadIntent(pending.intent, readFresh, request.controller);
    let fresh = false;
    try {
      if (
        isCurrent(frame) &&
        recovery.current === request &&
        !request.controller.signal.aborted &&
        result !== undefined
      ) {
        cacheFresh(result.data);
        fresh = true;
      }
    } catch {
      fresh = false;
    }
    if (recovery.current !== request) return;
    recovery.current = null;
    if (!isCurrentThread(frame)) return;
    const live = current.current;
    const receipt = fresh ? result?.receipt : undefined;
    if (
      receipt === undefined ||
      (receipt.state !== "applied" && receipt.state !== "cancelled" && receipt.state !== "denied")
    ) {
      gate.current = { frame: live, busy: false, locked: true };
      setStatus({ frame: live, kind: "uncertain" });
      return;
    }
    gate.current = { frame: live, busy: false, locked: false };
    unconfirmed.current = null;
    const applied = receipt.state === "applied" && pending.intent.owned;
    setStatus(applied ? null : { frame: live, kind: "failed" });
    if (applied && live.canMarkRead) confirmed.current();
  }

  // A capability transition must not discard an unresolved operation on this thread.
  const active = status?.frame.threadId === frame.threadId ? status.kind : null;
  return {
    busy: automaticPending || active === "pending" || active === "refreshing",
    uncertain: active === "uncertain" || active === "refreshing",
    failed: active === "failed",
    markUnread,
    refresh,
  };
}
