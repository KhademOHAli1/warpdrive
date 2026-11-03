"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  type PendingReadIntent,
  type ReadIntentRecovery,
  refreshThreadReadIntent,
  runThreadReadIntent,
} from "./threadReadIntent.client";

type FreshThread = ReadIntentRecovery["data"];
type ReadFrame = { key: string; selection: string };
type ReadBatch = { frame: ReadFrame };
type Feedback = ReadFrame & { failed: boolean };
type ReadSnapshot = { busy: ReadonlySet<string>; uncertain: ReadonlySet<string> };
type RecoveryRequest = { id: string; intent: PendingReadIntent; controller: AbortController };
type RecoveryOutcome = PromiseSettledResult<ReadIntentRecovery | undefined>;

function selectionKey(ids: Iterable<string>): string {
  return JSON.stringify([...ids].sort());
}

// These hosts own selection; the receipt ledger survives selection and view changes.
// It only fences read intents. Folder-write recovery remains a separate workflow.
export function useBulkThreadReadState({
  frameKey,
  selected,
  replaceSelection,
  readFresh,
  cacheFresh,
  onConfirmed,
}: {
  frameKey: string;
  selected: ReadonlySet<string>;
  replaceSelection: (ids: readonly string[]) => void;
  readFresh: (threadId: string, signal: AbortSignal) => Promise<FreshThread>;
  cacheFresh?: (threadId: string, data: FreshThread) => void;
  onConfirmed: () => void;
}) {
  const key = selectionKey(selected);
  const frame = useMemo(() => ({ key: frameKey, selection: key }), [frameKey, key]);
  const current = useRef(frame);
  const mounted = useRef(false);
  const unresolved = useRef(new Map<string, PendingReadIntent>());
  const executing = useRef(new Map<string, ReadBatch>());
  const recovering = useRef(new Map<string, AbortController>());
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [snapshot, setSnapshot] = useState<ReadSnapshot>(() => ({
    busy: new Set(),
    uncertain: new Set(),
  }));
  const callbacks = useRef({ replaceSelection, readFresh, cacheFresh, onConfirmed });
  useLayoutEffect(() => {
    callbacks.current = { replaceSelection, readFresh, cacheFresh, onConfirmed };
  });
  useLayoutEffect(() => {
    current.current = frame;
    // A late status response must not start a GET or update another view/selection.
    for (const controller of recovering.current.values()) controller.abort();
  }, [frame]);
  useLayoutEffect(() => {
    const controllers = recovering.current;
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const controller of controllers.values()) controller.abort();
    };
  }, []);

  function isCurrent(expected: ReadFrame): boolean {
    return mounted.current && current.current === expected;
  }
  function notify(): void {
    if (!mounted.current) return;
    // Publish copies for rendering; the private ledgers stay inside event/effect work.
    setSnapshot({
      busy: new Set([...executing.current.keys(), ...recovering.current.keys()]),
      uncertain: new Set(unresolved.current.keys()),
    });
  }
  function hasBarrier(ids: readonly string[]): boolean {
    return ids.some(
      (id) => executing.current.has(id) || recovering.current.has(id) || unresolved.current.has(id),
    );
  }

  async function run(read: boolean): Promise<void> {
    const ids = [...selected];
    if (!isCurrent(frame) || ids.length === 0 || hasBarrier(ids)) return;
    const batch = { frame };
    for (const id of ids) executing.current.set(id, batch);
    setFeedback(null);
    notify();
    // Every action has its own bounded receipt lifecycle; a rejection cannot abandon peers.
    const outcomes = await Promise.allSettled(
      ids.map((id) => runThreadReadIntent(id, read, () => isCurrent(batch.frame))),
    );
    const retained: string[] = [];
    let applied = false;
    let failed = false;
    for (const [index, outcome] of outcomes.entries()) {
      const id = ids[index];
      if (id === undefined || executing.current.get(id) !== batch) continue;
      executing.current.delete(id);
      if (outcome.status === "fulfilled" && outcome.value.kind === "applied") {
        applied = true;
        continue;
      }
      retained.push(id);
      if (outcome.status === "fulfilled" && outcome.value.kind === "uncertain")
        unresolved.current.set(id, outcome.value.intent);
      else failed = true;
    }
    if (isCurrent(batch.frame)) {
      setFeedback({ key: frame.key, selection: selectionKey(retained), failed });
      callbacks.current.replaceSelection(retained);
    }
    // Confirmed mailbox writes still invalidate caches after the visible selection changes.
    if (applied) callbacks.current.onConfirmed();
    // Store old unresolved operation IDs privately, without overwriting a newer selection.
    notify();
  }

  function finishRecovery(
    entry: RecoveryRequest,
    outcome: RecoveryOutcome,
    expected: ReadFrame,
  ): "confirmed" | "released" | undefined {
    if (recovering.current.get(entry.id) !== entry.controller) return undefined;
    recovering.current.delete(entry.id);
    if (!isCurrent(expected) || entry.controller.signal.aborted || outcome.status !== "fulfilled")
      return undefined;
    const result = outcome.value;
    if (result === undefined || unresolved.current.get(entry.id) !== entry.intent) return undefined;
    const state = result.receipt.state;
    if (state !== "applied" && state !== "cancelled" && state !== "denied") return undefined;
    try {
      callbacks.current.cacheFresh?.(entry.id, result.data);
    } catch {
      return undefined;
    }
    unresolved.current.delete(entry.id);
    return state === "applied" && entry.intent.owned ? "confirmed" : "released";
  }

  async function refresh(): Promise<void> {
    const ids = [...selected];
    if (
      !isCurrent(frame) ||
      ids.some((id) => executing.current.has(id) || recovering.current.has(id))
    )
      return;
    const pending = ids.flatMap((id) => {
      const intent = unresolved.current.get(id);
      if (intent === undefined) return [];
      const controller = new AbortController();
      recovering.current.set(id, controller);
      return [{ id, intent, controller }];
    });
    if (pending.length === 0) return;
    notify();
    const outcomes = await Promise.allSettled(
      pending.map(({ id, intent, controller }) =>
        refreshThreadReadIntent(
          intent,
          (signal) => callbacks.current.readFresh(id, signal),
          controller,
        ),
      ),
    );
    const confirmed = new Set<string>();
    let releasedWithoutApplication = false;
    for (const [index, outcome] of outcomes.entries()) {
      const entry = pending[index];
      if (entry === undefined) continue;
      const disposition = finishRecovery(entry, outcome, frame);
      if (disposition === "confirmed") confirmed.add(entry.id);
      else if (disposition === "released") releasedWithoutApplication = true;
    }
    if (isCurrent(frame)) {
      const retained = ids.filter((id) => !confirmed.has(id));
      setFeedback({
        key: frame.key,
        selection: selectionKey(retained),
        failed: releasedWithoutApplication,
      });
      if (confirmed.size > 0) {
        callbacks.current.replaceSelection(retained);
        callbacks.current.onConfirmed();
      }
    }
    notify();
  }

  const ids = [...selected];
  const busy = ids.some((id) => snapshot.busy.has(id));
  const uncertain = ids.some((id) => snapshot.uncertain.has(id));
  return {
    busy,
    uncertain,
    locked: busy || uncertain,
    failed:
      feedback?.key === frame.key && feedback.selection === frame.selection && feedback.failed,
    run,
    refresh,
  };
}
