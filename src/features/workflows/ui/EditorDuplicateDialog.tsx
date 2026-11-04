"use client";

import { type ReactNode, useId } from "react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/Input";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";

export function EditorDuplicateDialog({
  name,
  onNameChange,
  recovery,
  pending,
  blocked,
  error,
  onSubmit,
  onClose,
  onCloseAutoFocus,
}: {
  name: string;
  onNameChange: (name: string) => void;
  recovery: ReactNode;
  pending: boolean;
  blocked: boolean;
  error: string | null;
  onSubmit: (name: string) => void;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const t = useAppTranslations("workflows");
  const id = useId();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{t("duplicateTitle")}</DialogTitle>
          <DialogDescription>{t("duplicateHint")}</DialogDescription>
        </DialogHeader>
        {error !== null && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!pending && !blocked && name.trim() !== "") onSubmit(name.trim());
          }}
        >
          <label htmlFor={id}>{t("duplicateName")}</label>
          <Input
            id={id}
            dir="auto"
            value={name}
            maxLength={120}
            disabled={pending || blocked}
            onChange={(event) => onNameChange(event.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={pending || blocked || name.trim() === ""}>
              {t(pending ? "working" : "duplicate")}
            </Button>
          </div>
        </form>
        {recovery}
      </DialogContent>
    </Dialog>
  );
}
