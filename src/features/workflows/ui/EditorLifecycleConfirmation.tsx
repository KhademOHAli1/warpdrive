"use client";

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
import { buttonVariants } from "@/components/ui/Button";

export function EditorLifecycleConfirmation({
  open,
  pending,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onOpenChange,
  onConfirm,
  onCloseAutoFocus,
}: {
  open: boolean;
  pending: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(value) => {
        if (!pending) onOpenChange(value);
      }}
    >
      <AlertDialogContent
        onCloseAutoFocus={onCloseAutoFocus}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            disabled={pending}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            className={buttonVariants({ variant: "default", size: "sm" })}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
