"use client";
import { useEffect, useState } from "react";
import { listMailboxConnections } from "../connections/api";
import type { ComposerMailbox } from "./composerMailbox.types";
export function useComposerMailboxes(initial?: ComposerMailbox[]) {
  const [mailboxes, setMailboxes] = useState<ComposerMailbox[]>(initial ?? []);
  const [known, setKnown] = useState(initial !== undefined);
  const [loading, setLoading] = useState(initial === undefined);
  const [error, setError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Retry deliberately restarts this request after a failed mailbox load.
  useEffect(() => {
    if (initial !== undefined) return;
    const controller = new AbortController();
    void listMailboxConnections(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setLoading(false);
        setError(!result.ok);
        if (result.ok) {
          setMailboxes(result.value);
          setKnown(true);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
          setError(true);
        }
      });
    return () => controller.abort();
  }, [initial, retryNonce]);
  return {
    mailboxes: initial ?? mailboxes,
    known,
    loading,
    error,
    retry: () => {
      setError(false);
      setLoading(true);
      setRetryNonce((value) => value + 1);
    },
  };
}
