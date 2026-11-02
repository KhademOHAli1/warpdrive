"use client";

import { useEffect, useRef, useState } from "react";
import { ERROR_IDS } from "@/constants/errorIds";
import type { InlineSaveResult } from "@/features/inline-edit/useInlineEditField";

export type DealInlineSaveFn<T> = (
  value: T,
  expectedWriteVersion: string,
) => Promise<InlineSaveResult>;

// A retained draft keeps the version displayed when editing began. A refreshed prop never
// authorizes that older draft; canceling and starting again explicitly takes a new snapshot.
export function useDealEditSnapshot<T>(current: T, writeVersion: string, initiallyEditing = false) {
  const [editing, setEditing] = useState(initiallyEditing);
  const [draft, setDraft] = useState(current);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const version = useRef<string | null>(initiallyEditing ? writeVersion : null);
  const pendingRef = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function start(): boolean {
    if (pendingRef.current) return false;
    if (version.current === null || error === null) {
      version.current = writeVersion;
      setDraft(current);
    }
    setError(null);
    setEditing(true);
    return true;
  }

  function cancel(): boolean {
    if (pendingRef.current) return false;
    version.current = null;
    setDraft(current);
    setError(null);
    setEditing(false);
    return true;
  }

  function commit(onSave: DealInlineSaveFn<T>, valueOverride?: T): void {
    const expected = version.current;
    if (pendingRef.current) return;
    setEditing(false);
    if (typeof expected !== "string" || expected === "") {
      setError(ERROR_IDS.DEAL_PRECONDITION);
      return;
    }
    pendingRef.current = true;
    setPending(true);
    setError(null);
    const next = valueOverride !== undefined ? valueOverride : draft;
    // Even a logical noop submitted by a caller must validate its original precondition.
    let saved: Promise<InlineSaveResult>;
    try {
      saved = onSave(next, expected);
    } catch (thrown) {
      pendingRef.current = false;
      setPending(false);
      setError(thrown instanceof Error ? thrown.message : String(thrown));
      return;
    }
    saved
      .then((result) => {
        if (mounted.current && !result.ok) setError(result.error);
      })
      .catch((thrown: unknown) => {
        if (mounted.current) setError(thrown instanceof Error ? thrown.message : String(thrown));
      })
      .finally(() => {
        pendingRef.current = false;
        if (mounted.current) setPending(false);
      });
  }

  return { editing, draft, pending, error, setDraft, start, cancel, commit };
}
