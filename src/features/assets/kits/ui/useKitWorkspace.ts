"use client";

import { type RefObject, useRef, useState } from "react";
import type { AssetsWorkspace } from "../../contracts";
import type { KitCommand, KitError, KitIntent, KitResult } from "../contracts";
import type { KitEditor } from "./KitDialog";

export type SubmitKit = (command: KitCommand) => Promise<KitResult>;

export function useKitWorkspace({
  submit,
  initialSelectedId = null,
  onWorkspace,
  inFlightRef,
  fallbackFocus,
}: {
  submit?: SubmitKit;
  initialSelectedId?: string | null;
  onWorkspace: (workspace: AssetsWorkspace) => void;
  inFlightRef: RefObject<boolean>;
  fallbackFocus: RefObject<HTMLInputElement | null>;
}) {
  const [editor, setEditor] = useState<KitEditor | null>(null);
  const [selectedId, select] = useState(initialSelectedId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<KitError | "transport" | null>(null);
  const [saved, setSaved] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const unconfirmed = useRef<{ intent: string; requestId: string } | null>(null);

  function open(button: HTMLButtonElement, next: KitEditor) {
    if (submit === undefined || inFlightRef.current) return;
    trigger.current = button;
    setEditor(next);
    setError(null);
    setSaved(false);
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

  async function save(intent: KitIntent) {
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
      select(result.kitId);
      setEditor(null);
      setSaved(true);
    } catch {
      setError("transport");
    } finally {
      inFlightRef.current = false;
      setPending(false);
    }
  }

  return { editor, selectedId, select, pending, error, saved, open, close, restoreFocus, save };
}
