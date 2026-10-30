"use client";
import type React from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

interface HiddenRecordNoticeProps {
  entityLabel: "Deal" | "Lead";
  title: string;
  onDismiss: () => void;
}

export function HiddenRecordNotice({
  entityLabel,
  title,
  onDismiss,
}: HiddenRecordNoticeProps): React.ReactNode {
  const noun = entityLabel.toLowerCase();
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{`${entityLabel} created, but you can't see it`}</AlertDialogTitle>
          <AlertDialogDescription>
            {`"${title}" was saved and assigned to another owner. Your visibility settings don't let you open this ${noun}. Ask its owner or an admin if you need access.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction className={cn(buttonVariants({ variant: "default", size: "sm" }))}>
            OK
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
