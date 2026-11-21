"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select } from "@/components/ui/Select";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { catalogMessages } from "./catalogMessages";

export function CatalogField({
  label,
  id,
  children,
}: {
  label: string;
  id?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {id === undefined ? (
        <span className="text-sm font-medium">{label}</span>
      ) : (
        <label className="text-sm font-medium" htmlFor={id}>
          {label}
        </label>
      )}
      {children}
    </div>
  );
}

export function CatalogSelect(props: React.ComponentProps<typeof Select>) {
  return (
    <Select
      {...props}
      triggerClassName="h-9 min-w-0 [&>span]:min-w-0 [&>span]:truncate"
      contentClassName={`${BLOCK_CLASS} ph-no-capture max-w-[min(28rem,90vw)]`}
    />
  );
}

export function CatalogCheckbox({
  id,
  label,
  checked,
  disabled,
  change,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  change: (next: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="inline-flex w-fit items-center gap-2 py-1.5 text-sm">
      <Checkbox
        id={id}
        label={label}
        checked={checked}
        disabled={disabled}
        onCheckedChange={change}
      />
      {label}
    </label>
  );
}

export function CatalogEditorDialog({
  title,
  description,
  pending,
  error,
  close,
  restoreFocus,
  submit,
  submitDisabled = false,
  children,
}: {
  title: string;
  description: string;
  pending: boolean;
  error: string | null;
  close: () => void;
  restoreFocus: () => void;
  submit: () => void;
  submitDisabled?: boolean;
  children: ReactNode;
}) {
  const t = catalogMessages[useLocale()];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) close();
      }}
    >
      <DialogContent
        className={`${BLOCK_CLASS} ph-no-capture max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl`}
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
          className="min-w-0"
          onSubmit={(event) => {
            event.preventDefault();
            if (!pending && !submitDisabled) submit();
          }}
        >
          <div className="space-y-4 p-1">{children}</div>
          {error !== null && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" disabled={pending} onClick={close}>
              {t.cancel}
            </Button>
            <Button type="submit" disabled={pending || submitDisabled}>
              {t.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
