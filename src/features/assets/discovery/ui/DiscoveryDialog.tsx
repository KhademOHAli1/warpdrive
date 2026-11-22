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

export function DiscoveryDialog({
  kind,
  title,
  description,
  pending,
  disabled,
  error,
  cancelLabel,
  submitLabel,
  close,
  restoreFocus,
  submit,
  children,
}: {
  kind: "view" | "batch";
  title: string;
  description: string;
  pending: boolean;
  disabled: boolean;
  error: string | null;
  cancelLabel: string;
  submitLabel: string;
  close: () => void;
  restoreFocus: () => void;
  submit: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) close();
      }}
    >
      <DialogContent
        data-asset-view-dialog={kind === "view" ? "" : undefined}
        data-asset-bulk-dialog={kind === "batch" ? "" : undefined}
        className={`${BLOCK_CLASS} ph-no-capture max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto sm:max-w-md`}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreFocus();
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
            if (!pending && !disabled) submit();
          }}
        >
          {children}
          {error !== null && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={close}>
              {cancelLabel}
            </Button>
            <Button type="submit" disabled={pending || disabled}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
