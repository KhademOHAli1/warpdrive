"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { readCsrfToken } from "@/utils/csrfCookie";
import { createWorkflowAction } from "../actions";
import { initialBlankDefinition, initialDefinition } from "../editorModel";
import { type LibraryWriteError, libraryWriteError } from "./libraryErrors";
import { workflowLocation } from "./libraryLocation";

export interface NewWorkflowMemory {
  name: string;
  template: "blank" | "followUp";
  unknown: boolean;
  ackId: string | null;
}

export function NewWorkflowDialog({
  allowed,
  returnTo,
  memory,
  onMemory,
  onClose,
  onCloseAutoFocus,
  onReview,
}: {
  allowed: boolean;
  returnTo: string;
  memory?: NewWorkflowMemory;
  onMemory: (value: NewWorkflowMemory) => void;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
  onReview: () => Promise<boolean>;
}) {
  const t = useAppTranslations("workflows");
  const router = useRouter();
  const id = useId();
  const [name, setName] = useState(memory?.name ?? t("defaultName"));
  const [template, setTemplate] = useState<"blank" | "followUp">(memory?.template ?? "followUp");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<LibraryWriteError | null>(
    memory?.unknown === true ? "writeUnknown" : null,
  );
  const [ackId, setAckId] = useState<string | null>(memory?.ackId ?? null);
  const [navigationError, setNavigationError] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const inFlight = useRef(false);
  const blocked = useRef(memory?.unknown === true || memory?.ackId != null);

  function openCreated(id: string) {
    setNavigationError(false);
    try {
      router.push(workflowLocation(id, returnTo));
    } catch {
      setNavigationError(true);
    }
  }

  async function create() {
    if (inFlight.current || blocked.current || !allowed) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    let result: Awaited<ReturnType<typeof createWorkflowAction>>;
    try {
      result = await createWorkflowAction(
        {
          name,
          definition:
            template === "blank"
              ? initialBlankDefinition(t("start"))
              : initialDefinition({
                  start: t("start"),
                  read: t("read"),
                  task: t("task"),
                  subject: t("subject"),
                }),
        },
        readCsrfToken(),
      );
    } catch {
      blocked.current = true;
      setError("writeUnknown");
      setReviewed(false);
      onMemory({ name, template, unknown: true, ackId: null });
      return;
    } finally {
      inFlight.current = false;
      setPending(false);
    }
    if (!result.ok) {
      setError(libraryWriteError(result.error));
      return;
    }
    // This ACK is retained even if subsequent local bookkeeping or Next navigation
    // fails. A void push is a request, never proof that the new route arrived.
    setAckId(result.value.id);
    blocked.current = true;
    try {
      onMemory({ name, template, unknown: false, ackId: result.value.id });
    } catch {
      setNavigationError(true);
    }
    openCreated(result.value.id);
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

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !inFlight.current && !reviewing) onClose();
      }}
    >
      <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{t("new")}</DialogTitle>
          <DialogDescription>{t("createHint")}</DialogDescription>
        </DialogHeader>
        {ackId !== null ? (
          <div className="space-y-4">
            <p role="status" className="text-success">
              {t("created")}
            </p>
            {navigationError && <p role="alert">{t("navigationAfterAck")}</p>}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  blocked.current = false;
                  setAckId(null);
                  setName(t("defaultName"));
                  setTemplate("followUp");
                  setError(null);
                  onMemory({
                    name: t("defaultName"),
                    template: "followUp",
                    unknown: false,
                    ackId: null,
                  });
                }}
              >
                {t("new")}
              </Button>
              <Button onClick={() => openCreated(ackId)}>{t("open")}</Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <div className="space-y-2">
              <p className="text-sm font-medium">{t("template")}</p>
              <Select
                ariaLabel={t("template")}
                value={template}
                disabled={pending || error === "writeUnknown" || !allowed}
                options={[
                  { value: "followUp", label: t("followUpTemplate") },
                  { value: "blank", label: t("blankTemplate") },
                ]}
                onChange={(value) => {
                  const next = value === "blank" ? "blank" : "followUp";
                  setTemplate(next);
                  onMemory({ name, template: next, unknown: false, ackId: null });
                }}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor={id} className="text-sm font-medium">
                {t("name")}
              </label>
              <Input
                id={id}
                dir="auto"
                value={name}
                maxLength={120}
                required
                autoFocus
                disabled={pending || error === "writeUnknown" || !allowed}
                onChange={(event) => {
                  setName(event.target.value);
                  onMemory({ name: event.target.value, template, unknown: false, ackId: null });
                }}
              />
            </div>
            {pending && <p role="status">{t("working")}</p>}
            {!allowed && <p role="alert">{t("denied")}</p>}
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
                    blocked.current = false;
                    setError(null);
                    setReviewed(false);
                    onMemory({ name, template, unknown: false, ackId: null });
                  }}
                >
                  {t("allowRetry")}
                </Button>
              </div>
            )}
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
                disabled={pending || !allowed || error === "writeUnknown" || name.trim() === ""}
              >
                {t("create")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
