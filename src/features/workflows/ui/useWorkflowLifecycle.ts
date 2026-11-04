"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ERROR_IDS } from "@/constants/errorIds";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import {
  archiveWorkflowAction,
  duplicateWorkflowAction,
  restoreWorkflowDraftAction,
  unarchiveWorkflowAction,
} from "../actions";
import { libraryReadDenied } from "./libraryErrors";
import { sanitizeLibraryReturnTo } from "./libraryLocation";
import type { useWorkflowEditor } from "./useWorkflowEditor";

type Editor = ReturnType<typeof useWorkflowEditor>;
type Operation = "archive" | "unarchive" | "restore";
type Failure =
  | "denied"
  | "conflict"
  | "lifecycleInvalid"
  | "copyUnavailable"
  | "error"
  | "writeUnknown";
type Acknowledgement = "copied" | "archivedSaved" | "unarchivedSaved" | "restoredDraft";
function failure(code: string, reason?: unknown): Failure {
  if (reason === "copy-unavailable") return "copyUnavailable";
  if (code === ERROR_IDS.WORKFLOW_DENIED) return "denied";
  if (code === ERROR_IDS.WORKFLOW_CONFLICT) return "conflict";
  if (code === ERROR_IDS.WORKFLOW_INVALID) return "lifecycleInvalid";
  return "error";
}

export function useWorkflowLifecycle(id: string, editor: Editor, returnTo: string) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [error, setError] = useState<Failure | null>(null);
  const [acknowledged, setAcknowledged] = useState<Acknowledgement | null>(null);
  const [copyId, setCopyId] = useState<string | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [navigationPending, setNavigationPending] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all([
        utils.workflows.get.invalidate({ id }),
        utils.workflows.list.invalidate(),
        utils.workflows.versions.invalidate({ id }),
      ]);
      const current = await utils.workflows.get.fetch({ id });
      editor.applyCurrentMetadata(current);
      router.refresh();
      setRefreshFailed(false);
      setError((currentError) => (currentError === "denied" ? null : currentError));
    } catch (readError) {
      if (libraryReadDenied(readError)) {
        editor.revokeAccess();
        setError("denied");
      }
      // The write's ACK remains authoritative when follow-up reads cannot refresh.
      setRefreshFailed(true);
    } finally {
      setRefreshing(false);
    }
  }
  function openCopy(destination = copyId, departureReviewed = false) {
    if (destination === null) return;
    const navigate = () => {
      // push returns void: keep a read/navigation-only recovery until this editor unmounts.
      setNavigationPending(true);
      try {
        const library = sanitizeLibraryReturnTo(returnTo);
        router.push(
          `/workflows/${encodeURIComponent(destination)}${library === "/workflows" ? "" : `?returnTo=${encodeURIComponent(library)}`}`,
        );
      } catch {
        setNavigationPending(true);
      }
    };
    if (departureReviewed) navigate();
    else editor.requestDeparture(navigate);
  }
  async function change(operation: Operation, versionNumber?: number) {
    if (unknown || editor.pending) return false;
    const allowed =
      operation === "archive"
        ? editor.capabilities.edit
        : operation === "unarchive"
          ? editor.capabilities.unarchive
          : editor.capabilities.restore;
    if (!allowed) return false;
    let committed = false;
    await editor.command(async () => {
      setError(null);
      setAcknowledged(null);
      let result: Awaited<
        ReturnType<
          | typeof archiveWorkflowAction
          | typeof unarchiveWorkflowAction
          | typeof restoreWorkflowDraftAction
        >
      >;
      try {
        const input = { id, revision: editor.revision };
        result =
          operation === "archive"
            ? await archiveWorkflowAction(input, readCsrfToken())
            : operation === "unarchive"
              ? await unarchiveWorkflowAction(input, readCsrfToken())
              : await restoreWorkflowDraftAction({ ...input, versionNumber }, readCsrfToken());
      } catch {
        setUnknown(true);
        setError("writeUnknown");
        return;
      }
      if (!result.ok) {
        setError(failure(result.error, "reason" in result ? result.reason : undefined));
        return;
      }
      // Adopt before any follow-up read; archive/unarchive never replace the local graph.
      editor.applyLifecycle(result.value, operation);
      committed = true;
      setAcknowledged(
        operation === "archive"
          ? "archivedSaved"
          : operation === "unarchive"
            ? "unarchivedSaved"
            : "restoredDraft",
      );
      await refresh();
    });
    return committed;
  }
  async function duplicate(name: string) {
    if (unknown || editor.pending || !editor.capabilities.duplicate || copyId !== null)
      return false;
    let committed = false;
    await editor.command(async () => {
      setError(null);
      setAcknowledged(null);
      let result: Awaited<ReturnType<typeof duplicateWorkflowAction>>;
      try {
        result = await duplicateWorkflowAction(
          { id, revision: editor.revision, name },
          readCsrfToken(),
        );
      } catch {
        setUnknown(true);
        setError("writeUnknown");
        return;
      }
      if (!result.ok) {
        setError(failure(result.error, "reason" in result ? result.reason : undefined));
        return;
      }
      committed = true;
      setCopyId(result.value.id);
      setAcknowledged("copied");
      // This dispatch is navigation only, and is never retried as a duplicate command.
      openCopy(result.value.id, true);
    });
    return committed;
  }
  return {
    error,
    acknowledged,
    copyId,
    refreshFailed,
    navigationPending,
    refreshing,
    unknown,
    change,
    duplicate,
    refresh,
    openCopy,
    allowRetry() {
      setUnknown(false);
      setError(null);
    },
    clearError() {
      setError(null);
    },
    dismissAck() {
      setAcknowledged(null);
    },
  };
}
