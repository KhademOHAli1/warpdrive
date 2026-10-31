"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { authScreensMessagesForLocale } from "@/features/auth/authScreensMessages";
import { FreshVerification } from "@/features/auth/ui/FreshVerification";
import { useAccountStatus } from "@/features/auth/ui/useAccountStatus";
import { statusSchema, workflowRequest } from "@/features/auth/ui/workflowRequest";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { MailboxConnectionFeedback, useMailboxConnectionTask } from "./useMailboxConnectionTask";

export function MailboxFreshAuthDialog({
  onClose,
  onConfirmed,
}: {
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const L = authScreensMessagesForLocale(useLocale()).flow;
  const auth = useAccountStatus();
  const task = useMailboxConnectionTask();
  const returnFocus = useRef<HTMLElement | null>(null);
  function confirmFreshness() {
    void task.run(async (signal) => {
      const result = await workflowRequest("status", statusSchema, signal);
      if (!result.ok || !result.data.fresh || result.data.needsMfa || result.data.needsEnrollment)
        return { ok: false, error: "fresh_auth_required" };
      return { ok: true, value: undefined };
    }, onConfirmed);
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-md"
        onOpenAutoFocus={() => {
          const active = document.activeElement;
          returnFocus.current = active instanceof HTMLElement ? active : null;
        }}
        onCloseAutoFocus={(event) => {
          if (returnFocus.current?.isConnected === true) {
            event.preventDefault();
            returnFocus.current.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{L.confirmIdentity}</DialogTitle>
          <DialogDescription>{L.confirmDescription}</DialogDescription>
        </DialogHeader>
        {auth.status === null && auth.error === null && (
          <p role="status" className="text-sm text-muted-foreground">
            {L.loading}
          </p>
        )}
        {auth.error !== null && (
          <div className="space-y-3">
            <p role="alert" className="text-sm text-destructive">
              {auth.error}
            </p>
            <Button
              variant="outline"
              disabled={task.busy}
              onClick={() =>
                void task.run(
                  async (signal) => {
                    await auth.refresh(signal);
                    return { ok: true, value: undefined };
                  },
                  () => undefined,
                )
              }
            >
              {L.retry}
            </Button>
            <a
              href="/login?returnTo=%2Fsettings%2Femail-sync"
              className="block text-sm text-action"
            >
              {L.backToLogin}
            </a>
          </div>
        )}
        {auth.status !== null &&
          (auth.status.needsMfa || auth.status.needsEnrollment ? (
            <div className="space-y-3">
              <p className="text-sm">{L.mfaRequired}</p>
              <a
                className="text-sm text-action"
                href="/auth/continue?returnTo=%2Fsettings%2Femail-sync"
              >
                {L.continue}
              </a>
            </div>
          ) : (
            <FreshVerification
              status={auth.status}
              refresh={confirmFreshness}
              returnTo="/settings/email-sync"
              embedded
            />
          ))}
        <MailboxConnectionFeedback error={task.error} />
        {task.busy && (
          <p role="status" className="text-sm text-muted-foreground">
            {L.working}
          </p>
        )}
        <DialogFooter className="border-t pt-4">
          <DialogClose asChild>
            <Button variant="ghost">{L.close}</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
