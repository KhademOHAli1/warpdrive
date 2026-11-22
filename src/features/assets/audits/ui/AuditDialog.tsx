"use client";

import { type ReactNode, useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { CatalogCheckbox } from "@/features/inventory/catalog/ui/CatalogFields";
import { SalesInput } from "@/features/inventory/sales/ui/SalesFields";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { type EquipmentAuditIntent, equipmentAuditCommand } from "../contracts";
import type { AuditWords } from "./messages";

export type AuditDialogState = {
  pending: boolean;
  error: string | null;
  close: () => void;
  restoreFocus: () => void;
  save: (intent: EquipmentAuditIntent) => void;
  attach: (file: File, rowId: string | null) => void;
};

type BaseProps = {
  type: EquipmentAuditIntent["type"] | "attach";
  title: string;
  description: string;
  label?: string;
  state: AuditDialogState;
  words: AuditWords;
  children?: ReactNode;
};

export function AuditDialog({
  type,
  title,
  description,
  label,
  state,
  words: t,
  children,
  action,
}: BaseProps & { action: (() => void) | null }) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !state.pending) state.close();
      }}
    >
      <DialogContent
        data-audit-dialog={type}
        className={`${BLOCK_CLASS} ph-no-capture max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto sm:max-w-2xl`}
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
            if (!state.pending) action?.();
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
              {t.cancel}
            </Button>
            <Button
              type="submit"
              data-audit-confirm={type}
              disabled={state.pending || action === null}
            >
              {label ?? t.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AuditCommandDialog({
  intent,
  state,
  ...props
}: BaseProps & { intent: EquipmentAuditIntent | null }) {
  const checkId = "00000000-0000-4000-8000-000000000001";
  const action =
    intent !== null && equipmentAuditCommand.safeParse({ ...intent, requestId: checkId }).success
      ? () => state.save(intent)
      : null;
  return <AuditDialog {...props} state={state} action={action} />;
}

export function AuditOptionGroup({
  title,
  options,
  selected,
  change,
  pending,
  words: t,
}: {
  title: string;
  options: { id: string; name: string }[];
  selected: string[];
  change: (ids: string[]) => void;
  pending: boolean;
  words: AuditWords;
}) {
  const id = useId();
  const { locale } = useLocalePreferences();
  const [search, setSearch] = useState("");
  const wanted = new Set(selected);
  const query = search.trim().toLocaleLowerCase(locale);
  const visible = options.filter(({ name }) => name.toLocaleLowerCase(locale).includes(query));
  return (
    <fieldset className="min-w-0 space-y-1.5 rounded-md border p-2" disabled={pending}>
      <legend className="px-1 text-sm font-medium">{title}</legend>
      {options.length > 8 && (
        <SalesInput
          label={`${t.filterOptions} – ${title}`}
          type="search"
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
        />
      )}
      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.noOptions}</p>
      ) : (
        <div className="flex max-h-44 flex-col overflow-y-auto">
          {visible.map((option) => (
            <CatalogCheckbox
              key={option.id}
              id={`${id}-${option.id}`}
              label={option.name}
              checked={wanted.has(option.id)}
              disabled={pending}
              change={(checked) => {
                const next = new Set(wanted);
                if (checked) next.add(option.id);
                else next.delete(option.id);
                change([...next]);
              }}
            />
          ))}
        </div>
      )}
    </fieldset>
  );
}
