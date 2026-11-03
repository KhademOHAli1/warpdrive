"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/Input";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { readCsrfToken } from "@/utils/csrfCookie";
import {
  archiveWorkflowAction,
  duplicateWorkflowAction,
  unarchiveWorkflowAction,
} from "../actions";
import type { WorkflowLibraryRow } from "../library";
import { type LibraryWriteError, libraryWriteError } from "./libraryErrors";
import { workflowLocation } from "./libraryLocation";

export type LibraryOperation = "archive" | "unarchive" | "duplicate";
export type LibraryAcknowledgement = Extract<
  Awaited<ReturnType<typeof archiveWorkflowAction>>,
  { ok: true }
>["value"];
export interface LibraryCommandMemory {
  name: string;
  unknown: boolean;
  ackId: string | null;
  sourceRevision: number;
}

function boundedName(value: string) {
  const characters = Array.from(value);
  while (characters.join("").length > 120) characters.pop();
  return characters.join("");
}

export function WorkflowLifecycleDialog({
  operation,
  row,
  returnTo,
  memory,
  onMemory,
  onClose,
  onCloseAutoFocus,
  onAcknowledged,
  onReview,
}: {
  operation: LibraryOperation;
  row: WorkflowLibraryRow;
  returnTo: string;
  memory?: LibraryCommandMemory;
  onMemory: (value: LibraryCommandMemory) => void;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
  onAcknowledged: (
    operation: "archive" | "unarchive",
    row: LibraryAcknowledgement,
  ) => Promise<void>;
  onReview: () => Promise<boolean>;
}) {
  const t = useAppTranslations("workflows");
  const router = useRouter();
  const id = useId();
  const retainedAck =
    memory?.ackId != null && memory.sourceRevision >= row.revision ? memory.ackId : null;
  const [name, setName] = useState(
    () => memory?.name ?? boundedName(t("duplicateDefaultName", { name: row.name })),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<LibraryWriteError | null>(
    memory?.unknown === true ? "writeUnknown" : null,
  );
  const [ackId, setAckId] = useState<string | null>(retainedAck);
  const [navigationError, setNavigationError] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const state = useRef<"ready" | "pending" | "ack" | "unknown">(
    memory?.unknown === true ? "unknown" : retainedAck === null ? "ready" : "ack",
  );

  function openCopy(id: string) {
    setNavigationError(false);
    try {
      router.push(workflowLocation(id, returnTo));
    } catch {
      setNavigationError(true);
    }
  }

  async function submit() {
    if (state.current !== "ready" || !row.capabilities[operation]) return;
    state.current = "pending";
    setPending(true);
    setError(null);
    const input = { id: row.id, revision: row.revision };
    const invoke = () =>
      operation === "archive"
        ? archiveWorkflowAction(input, readCsrfToken())
        : operation === "unarchive"
          ? unarchiveWorkflowAction(input, readCsrfToken())
          : duplicateWorkflowAction({ ...input, name }, readCsrfToken());
    let result: Awaited<ReturnType<typeof invoke>>;
    try {
      result = await invoke();
    } catch {
      state.current = "unknown";
      setError("writeUnknown");
      setReviewed(false);
      setPending(false);
      onMemory({ name, unknown: true, ackId: null, sourceRevision: row.revision });
      return;
    }
    if (!result.ok) {
      state.current = "ready";
      setPending(false);
      setError(libraryWriteError(result.error, "reason" in result ? result.reason : undefined));
      return;
    }
    state.current = "ack";
    setAckId(result.value.id);
    setPending(false);
    onMemory({ name, unknown: false, ackId: result.value.id, sourceRevision: row.revision });
    if (operation === "duplicate") {
      openCopy(result.value.id);
      return;
    }
    // Read/navigation work starts only after the authoritative write is recorded.
    try {
      await onAcknowledged(operation, result.value);
    } catch {
      setRefreshError(true);
    }
  }

  async function review() {
    if (reviewing) return;
    setReviewing(true);
    try {
      setReviewed(await onReview());
    } finally {
      setReviewing(false);
    }
  }

  const feedback = (
    <>
      {pending && <p role="status">{t("working")}</p>}
      {error !== null && (
        <p role="alert" className="text-destructive">
          {t(error)}
        </p>
      )}
      {error === "writeUnknown" && (
        <div className="space-y-3">
          <p className="text-sm">{t("retryReconcileHint")}</p>
          <Button
            type="button"
            variant="outline"
            disabled={reviewing}
            onClick={() => void review()}
          >
            {t("reviewLibrary")}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!reviewed || reviewing}
            onClick={() => {
              state.current = "ready";
              setError(null);
              setReviewed(false);
              onMemory({ name, unknown: false, ackId: null, sourceRevision: row.revision });
            }}
          >
            {t("allowRetry")}
          </Button>
        </div>
      )}
    </>
  );

  if (operation === "duplicate")
    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open && state.current !== "pending" && !reviewing) onClose();
        }}
      >
        <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
          <DialogHeader>
            <DialogTitle>{t("duplicateTitle")}</DialogTitle>
            <DialogDescription>{t("duplicateHint")}</DialogDescription>
          </DialogHeader>
          <p className="text-sm">
            <bdi>{row.name}</bdi> · {t("savedRevision", { revision: String(row.revision) })}
          </p>
          {ackId !== null ? (
            <div className="space-y-4">
              <p role="status" className="text-success">
                {t("copied")}
              </p>
              {navigationError && <p role="alert">{t("navigationAfterAck")}</p>}
              <DialogFooter>
                <Button onClick={() => openCopy(ackId)}>{t("openCopy")}</Button>
              </DialogFooter>
            </div>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <div className="space-y-2">
                <label htmlFor={id}>{t("duplicateName")}</label>
                <Input
                  id={id}
                  autoFocus
                  dir="auto"
                  maxLength={120}
                  required
                  value={name}
                  disabled={pending || error === "writeUnknown"}
                  onChange={(event) => {
                    setName(event.target.value);
                    onMemory({
                      name: event.target.value,
                      unknown: false,
                      ackId: null,
                      sourceRevision: row.revision,
                    });
                  }}
                />
              </div>
              {feedback}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending || reviewing}
                  onClick={onClose}
                >
                  {t("cancel")}
                </Button>
                <Button
                  type="submit"
                  disabled={pending || error === "writeUnknown" || name.trim() === ""}
                >
                  {t("duplicate")}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    );

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && state.current !== "pending" && !reviewing) onClose();
      }}
    >
      <AlertDialogContent
        onCloseAutoFocus={onCloseAutoFocus}
        onEscapeKeyDown={(event) => {
          if (state.current === "pending") event.preventDefault();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t(operation === "archive" ? "archiveTitle" : "unarchiveTitle")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t(operation === "archive" ? "archiveHint" : "unarchiveHint")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <p className="text-sm">
          <bdi>{row.name}</bdi> · {t("savedRevision", { revision: String(row.revision) })}
        </p>
        {feedback}
        {ackId !== null && (
          <p role="status">{t(operation === "archive" ? "archivedSaved" : "unarchivedSaved")}</p>
        )}
        {refreshError && <p role="alert">{t("refreshAfterAck")}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel
            disabled={pending || reviewing}
            className={buttonVariants({ variant: "outline" })}
          >
            {t(ackId === null ? "cancel" : "close")}
          </AlertDialogCancel>
          {ackId === null && (
            <AlertDialogAction
              className={buttonVariants({ variant: "default" })}
              disabled={pending || error === "writeUnknown"}
              onClick={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              {t(operation)}
            </AlertDialogAction>
          )}
          {refreshError && (
            <Button
              variant="outline"
              onClick={() => void onReview().then((ok) => setRefreshError(!ok))}
            >
              {t("refresh")}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
