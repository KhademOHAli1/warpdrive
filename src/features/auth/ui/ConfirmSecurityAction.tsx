"use client";
import type { ReactNode } from "react";
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
import { Button } from "@/components/ui/Button";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { authScreensMessagesForLocale } from "../authScreensMessages";

export function ConfirmSecurityAction({
  open,
  setOpen,
  onConfirm,
  children,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  const L = authScreensMessagesForLocale(useLocale()).flow;
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{L.removeConfirmation}</AlertDialogTitle>
          <AlertDialogDescription>{L.removeDescription}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {L.cancel}
            </Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button
              onClick={() => {
                setOpen(false);
                onConfirm();
              }}
            >
              {L.continue}
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
