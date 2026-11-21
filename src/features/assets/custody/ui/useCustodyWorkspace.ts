"use client";

import { type RefObject, useRef, useState } from "react";
import type { AssetsWorkspace } from "../../contracts";
import type {
  CustodyCommand,
  CustodyError,
  CustodyIntent,
  CustodyOutcome,
  CustodyResult,
} from "../contracts";
import type { CustodyEditor } from "./CustodyDialogs";

export type SubmitCustody = (command: CustodyCommand) => Promise<CustodyResult>;

export function useCustodyWorkspace({
  submit,
  onWorkspace,
  inFlightRef,
  fallbackFocus,
}: {
  submit?: SubmitCustody;
  onWorkspace: (workspace: AssetsWorkspace) => void;
  inFlightRef: RefObject<boolean>;
  fallbackFocus: RefObject<HTMLInputElement | null>;
}) {
  const [editor, setEditor] = useState<CustodyEditor | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<CustodyError | "transport" | null>(null);
  const [saved, setSaved] = useState(false);
  const [outcomes, setOutcomes] = useState<CustodyOutcome[]>([]);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const unconfirmed = useRef<{ intent: string; requestId: string } | null>(null);

  function open(button: HTMLButtonElement, next: CustodyEditor) {
    if (submit === undefined || inFlightRef.current) return;
    trigger.current = button;
    setEditor(next);
    setError(null);
    setSaved(false);
    setOutcomes([]);
  }

  function close() {
    if (inFlightRef.current) return;
    setEditor(null);
    setError(null);
  }

  function restoreFocus() {
    if (trigger.current?.isConnected === true) trigger.current.focus();
    else fallbackFocus.current?.focus();
  }

  function selectMany(ids: string[], checked: boolean) {
    setSaved(false);
    setOutcomes([]);
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (checked && next.size < 100) next.add(id);
        if (!checked) next.delete(id);
      }
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
    setOutcomes([]);
    setSaved(false);
  }

  async function save(intent: CustodyIntent) {
    if (submit === undefined || inFlightRef.current) return;
    inFlightRef.current = true;
    setPending(true);
    setError(null);
    const key = JSON.stringify(intent);
    const previous = unconfirmed.current;
    const requestId = previous?.intent === key ? previous.requestId : crypto.randomUUID();
    unconfirmed.current = { intent: key, requestId };
    try {
      const result = await submit({ ...intent, requestId });
      unconfirmed.current = null;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onWorkspace(result.value);
      setEditor(null);
      if (intent.type === "bulkAssign" || intent.type === "bulkReturn") {
        setOutcomes(result.outcomes);
        setSelected(new Set());
      } else {
        setSaved(true);
      }
    } catch {
      setError("transport");
    } finally {
      inFlightRef.current = false;
      setPending(false);
    }
  }

  return {
    editor,
    selected,
    pending,
    error,
    saved,
    outcomes,
    open,
    close,
    restoreFocus,
    selectMany,
    clearSelection,
    save,
  };
}
