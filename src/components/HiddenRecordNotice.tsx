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
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
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
  const t = useAppTranslations("entityCreate");
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t(entityLabel === "Deal" ? "hiddenDealTitle" : "hiddenLeadTitle")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t(entityLabel === "Deal" ? "hiddenDealDescription" : "hiddenLeadDescription", {
              title,
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction className={cn(buttonVariants({ variant: "default", size: "sm" }))}>
            {t("acknowledge")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
