"use client";
import { useRef, useState } from "react";
import type { SendEmailOutcome } from "@/types/mail";
import { readCsrfToken } from "@/utils/csrfCookie";
import { cancelOutboxAction } from "../folderActions";
import { getSendStatusAction } from "../sendStatusAction";
import { useComposerMailboxMessages } from "./useComposerMailboxMessages";
export function useComposerReceipt({
  accountId,
  intentId,
  outcome,
  onOutcome,
  onNewIntent,
}: {
  accountId: string;
  intentId: string;
  outcome: SendEmailOutcome | null;
  onOutcome: (value: SendEmailOutcome) => void;
  onNewIntent: (id: string) => void;
}) {
  const L = useComposerMailboxMessages();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const inFlight = useRef(false);
  const state = outcome?.deliveryOutcome?.state;
  const canEdit =
    outcome?.status === "failed" &&
    outcome.attemptId !== undefined &&
    state !== "accepted" &&
    state !== "partial" &&
    state !== "unknown";
  async function check(): Promise<void> {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await getSendStatusAction(readCsrfToken(), {
        accountId,
        idempotencyKey: intentId,
      });
      if (result.ok) onOutcome(result.value);
      else setError(L.statusError);
    } catch {
      setError(L.statusError);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function confirmEdit(): Promise<void> {
    if (inFlight.current || !canEdit || outcome.attemptId === undefined) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await cancelOutboxAction(readCsrfToken(), { attemptId: outcome.attemptId });
      if (result.ok) {
        setEditOpen(false);
        onNewIntent(crypto.randomUUID());
      } else setError(L.editBlocked);
    } catch {
      setError(L.editBlocked);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return { busy, error, check, canEdit, editOpen, setEditOpen, confirmEdit };
}
