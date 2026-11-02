import { captureException, currentRoute } from "@/features/observability/capture";
import { readCsrfToken } from "@/utils/csrfCookie";
import { deleteDraftAction, saveDraftAction } from "../folderActions";
import type { DraftAutosaveDeps, DraftSaveState } from "./draftAutosave.types";

export const DRAFT_DEBOUNCE_MS = 1500;
export function draftAutosavePayload(d: DraftAutosaveDeps) {
  return {
    accountId: d.accountId,
    threadId: d.threadId,
    subject: d.subject,
    bodyHtml: d.body,
    toEmails: d.toList,
    ccEmails: d.ccList,
    bccEmails: d.bccList ?? [],
    attachments: d.attachments ?? [],
    sendIntentId: d.sendIntentId,
    trackOpens: d.trackOpens ?? false,
    trackLinks: d.trackLinks ?? false,
    visibility: d.visibility,
    linkDealId: d.linkDealId ?? null,
    linkPersonId: d.linkPersonId ?? null,
  };
}
function hasContent(d: DraftAutosaveDeps): boolean {
  return (
    d.subject.trim() !== "" ||
    d.body.trim() !== "" ||
    d.toList.length > 0 ||
    d.ccList.length > 0 ||
    (d.bccList?.length ?? 0) > 0 ||
    (d.attachments?.length ?? 0) > 0
  );
}

export function createDraftAutosaveScope(setStatus: (status: DraftSaveState) => void) {
  let latest: DraftAutosaveDeps | undefined;
  let accountId: string | undefined;
  let epoch = 0;
  let paused = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let createId = "";
  let creationAttempted = false;
  const cancelTimer = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const current = (snapshot: DraftAutosaveDeps, generation: number) =>
    generation === epoch && accountId === snapshot.accountId;

  function rebind(nextAccountId: string, draftId: string | undefined): void {
    cancelTimer();
    epoch += 1;
    accountId = nextAccountId;
    paused = false;
    creationAttempted = false;
    createId = crypto.randomUUID();
    if (latest !== undefined) {
      latest.draftIdRef.current = draftId;
      latest.inFlightRef.current = null;
    }
  }
  function update(next: DraftAutosaveDeps): void {
    const previous = latest;
    latest = next;
    if (accountId !== next.accountId) rebind(next.accountId, next.initialDraftId);
    if (previous?.enabled !== false && next.enabled === false) {
      cancelTimer();
      epoch += 1;
    }
  }

  async function save(snapshot: DraftAutosaveDeps, generation: number): Promise<boolean> {
    if (!current(snapshot, generation)) return false;
    setStatus("saving");
    if (!hasContent(snapshot)) return removeEmpty(snapshot, generation);
    const id = snapshot.draftIdRef.current;
    const retryCreation = id === undefined && creationAttempted;
    if (id === undefined) creationAttempted = true;
    const result = await saveDraftAction(readCsrfToken(), {
      ...draftAutosavePayload(snapshot),
      ...(id === undefined ? { createId } : { id }),
    });
    if (!current(snapshot, generation)) return false;
    if (!result.ok) {
      setStatus("error");
      return false;
    }
    snapshot.draftIdRef.current = result.value.id;
    if (retryCreation) {
      // A lost create response may replay an older row. Confirm the latest snapshot as an update.
      const refreshed = await saveDraftAction(readCsrfToken(), {
        ...draftAutosavePayload(snapshot),
        id: result.value.id,
      });
      if (!current(snapshot, generation)) return false;
      setStatus(refreshed.ok ? "saved" : "error");
      return refreshed.ok;
    }
    setStatus("saved");
    return true;
  }
  async function removeEmpty(snapshot: DraftAutosaveDeps, generation: number): Promise<boolean> {
    const id = snapshot.draftIdRef.current;
    if (id === undefined) {
      setStatus("idle");
      return true;
    }
    const result = await deleteDraftAction(readCsrfToken(), { draftId: id });
    if (!current(snapshot, generation)) return false;
    if (result.ok) {
      snapshot.draftIdRef.current = undefined;
      creationAttempted = false;
      createId = crypto.randomUUID();
    }
    setStatus(result.ok ? "idle" : "error");
    return result.ok;
  }
  function enqueue(snapshot: DraftAutosaveDeps): Promise<boolean> {
    const generation = epoch;
    const result = (snapshot.inFlightRef.current ?? Promise.resolve())
      .then(() => save(snapshot, generation))
      .catch((error: unknown) => {
        if (current(snapshot, generation)) {
          setStatus("error");
          captureException(error, { surface: "email-draft-autosave", route: currentRoute() });
        }
        return false;
      });
    const tracked = result
      .then(() => undefined)
      .finally(() => {
        if (snapshot.inFlightRef.current === tracked) snapshot.inFlightRef.current = null;
      });
    snapshot.inFlightRef.current = tracked;
    return result;
  }
  function schedule(): () => void {
    cancelTimer();
    if (latest === undefined || paused || latest.enabled === false) return cancelTimer;
    const snapshot = latest;
    timer = setTimeout(() => {
      timer = undefined;
      void enqueue(snapshot);
    }, DRAFT_DEBOUNCE_MS);
    return cancelTimer;
  }
  function flush(): Promise<boolean> {
    cancelTimer();
    return latest === undefined || latest.enabled === false
      ? Promise.resolve(true)
      : enqueue(latest);
  }
  return {
    update,
    rebind,
    schedule,
    flush,
    suspend: () => {
      cancelTimer();
      epoch += 1;
      paused = true;
    },
    resume: () => {
      paused = false;
      schedule();
    },
    dispose: () => {
      cancelTimer();
      epoch += 1;
    },
  };
}
