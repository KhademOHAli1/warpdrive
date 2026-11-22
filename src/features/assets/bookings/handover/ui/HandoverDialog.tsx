"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { type BookingHandoverIntent, bookingHandoverCommand } from "../contracts";
import type { HandoverWords } from "./messages";

export type HandoverDialogState = {
  pending: boolean;
  error: string | null;
  close: () => void;
  restoreFocus: () => void;
  submit: (intent: BookingHandoverIntent) => void;
};

const validationId = "00000000-0000-4000-8000-000000000001";
export type DialogType = BookingHandoverIntent["type"];

export function HandoverDialog({
  type,
  title,
  description,
  confirm,
  intent,
  state,
  words,
  children,
}: {
  type: DialogType;
  title: string;
  description: string;
  confirm: string;
  intent: BookingHandoverIntent | null;
  state: HandoverDialogState;
  words: HandoverWords;
  children: ReactNode;
}) {
  const valid =
    intent !== null &&
    bookingHandoverCommand.safeParse({ ...intent, requestId: validationId }).success;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !state.pending) state.close();
      }}
    >
      <DialogContent
        data-handover-dialog={type}
        className={`${BLOCK_CLASS} ph-no-capture max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl`}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          state.restoreFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          className="min-w-0 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && !state.pending) state.submit(intent);
          }}
        >
          {children}
          {state.error !== null && (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={state.pending} onClick={state.close}>
              {words.cancel}
            </Button>
            <Button type="submit" data-handover-confirm={type} disabled={!valid || state.pending}>
              {confirm}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
