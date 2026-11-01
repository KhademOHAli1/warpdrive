"use client";
import { useRef, useState } from "react";
import { readCsrfToken } from "@/utils/csrfCookie";
import { saveDraftAction } from "../folderActions";
import type { ComposerMailbox } from "./composerMailbox.types";
import type { DraftAutosaveDeps } from "./draftAutosave.types";
import { draftAutosavePayload } from "./draftAutosaveScope";
import { useComposerMailboxMessages } from "./useComposerMailboxMessages";
import type { useDraftAutosave } from "./useDraftAutosave";

interface PendingCopy {
  target: ComposerMailbox;
  createId: string;
  sendIntentId: string;
}
export function useMailboxDraftCopy({
  snapshot,
  autosave,
  locked,
  onCopied,
}: {
  snapshot: DraftAutosaveDeps;
  autosave: ReturnType<typeof useDraftAutosave>;
  locked: boolean;
  onCopied: (target: ComposerMailbox, draftId: string, sendIntentId: string) => void;
}) {
  const L = useComposerMailboxMessages();
  const [pending, setPending] = useState<PendingCopy | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  function request(target: ComposerMailbox): void {
    if (
      locked ||
      target.id === snapshot.accountId ||
      target.status !== "connected" ||
      !target.capabilities.send
    )
      return;
    setError(null);
    setPending({ target, createId: crypto.randomUUID(), sendIntentId: crypto.randomUUID() });
  }
  async function confirm(): Promise<void> {
    if (pending === null || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      if (!(await autosave.flush())) {
        setError(L.saveError);
        return;
      }
      autosave.suspend();
      const result = await saveDraftAction(readCsrfToken(), {
        ...draftAutosavePayload(snapshot),
        accountId: pending.target.id,
        threadId: null,
        createId: pending.createId,
        sendIntentId: pending.sendIntentId,
      });
      if (!result.ok) {
        autosave.resume();
        setError(L.copyError);
        return;
      }
      autosave.rebind(pending.target.id, result.value.id);
      onCopied(pending.target, result.value.id, pending.sendIntentId);
      setPending(null);
    } catch {
      autosave.resume();
      setError(L.copyError);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return {
    pending,
    busy,
    error,
    request,
    confirm,
    cancel: () => {
      if (!inFlight.current) {
        setPending(null);
        setError(null);
        autosave.resume();
      }
    },
  };
}
