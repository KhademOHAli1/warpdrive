"use client";

import type { ReactNode, RefObject } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";

export function BuilderFrame({
  expanded,
  onExpandedChange,
  returnFocus,
  children,
}: {
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  returnFocus: RefObject<HTMLButtonElement | null>;
  children: ReactNode;
}) {
  const t = useAppTranslations("workflows");
  if (!expanded) return children;
  return (
    <Dialog open onOpenChange={onExpandedChange}>
      <DialogContent
        className="flex h-[calc(100dvh-24px)] w-[calc(100vw-24px)] max-w-none flex-col gap-0 overflow-hidden rounded-xl p-0 sm:max-w-none"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus.current?.focus();
        }}
      >
        <DialogTitle className="sr-only">{t("canvas")}</DialogTitle>
        <DialogDescription className="sr-only">{t("focusHint")}</DialogDescription>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
