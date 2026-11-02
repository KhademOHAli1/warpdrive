"use client";
import { useEffect, useLayoutEffect, useState } from "react";
import type { DraftAutosaveDeps, DraftSaveState } from "./draftAutosave.types";
import { createDraftAutosaveScope, DRAFT_DEBOUNCE_MS } from "./draftAutosaveScope";

export type { DraftAutosaveDeps } from "./draftAutosave.types";
export const DEBOUNCE_MS = DRAFT_DEBOUNCE_MS;

export function useDraftAutosave(deps: DraftAutosaveDeps) {
  const [status, setStatus] = useState<DraftSaveState>("idle");
  const [retryNonce, setRetryNonce] = useState(0);
  const [scope] = useState(() => createDraftAutosaveScope(setStatus));
  useLayoutEffect(() => scope.update(deps), [scope, deps]);
  const {
    accountId,
    threadId,
    subject,
    body,
    toList,
    ccList,
    bccList,
    attachments,
    sendIntentId,
    trackOpens,
    trackLinks,
    visibility,
    linkDealId,
    linkPersonId,
    draftIdRef,
    inFlightRef,
    enabled,
  } = deps;
  // biome-ignore lint/correctness/useExhaustiveDependencies: Tracked snapshots and Retry deliberately schedule saves.
  useEffect(
    () => scope.schedule(),
    [
      scope,
      retryNonce,
      accountId,
      threadId,
      subject,
      body,
      toList,
      ccList,
      bccList,
      attachments,
      sendIntentId,
      trackOpens,
      trackLinks,
      visibility,
      linkDealId,
      linkPersonId,
      draftIdRef,
      inFlightRef,
      enabled,
    ],
  );
  useEffect(() => () => scope.dispose(), [scope]);
  return {
    status,
    retry: () => setRetryNonce((value) => value + 1),
    flush: scope.flush,
    rebind: scope.rebind,
    suspend: scope.suspend,
    resume: scope.resume,
  };
}
