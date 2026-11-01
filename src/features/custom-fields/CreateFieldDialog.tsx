"use client";

import { useRouter } from "next/navigation";
import { type ReactElement, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import {
  CUSTOM_FIELD_TYPES,
  type CustomFieldTarget,
  type CustomFieldType,
} from "@/constants/customFieldTypes";
import { createDefAction } from "@/features/custom-fields/actions";
import { settingsFieldType } from "@/features/identity/settingsMessages";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import type { CustomFieldDef } from "@/types/customFields";
import { readCsrfToken } from "@/utils/csrfCookie";

const OPTION_TYPES = new Set<CustomFieldType>(["single_option", "multi_option"]);

function CreateFieldForm({
  target,
  onCreated,
  onCancel,
  onPending,
}: {
  target: CustomFieldTarget;
  onCreated: (field: CustomFieldDef) => void;
  onCancel: () => void;
  onPending: (pending: boolean) => void;
}) {
  const S = useSettingsMessages();
  const id = useId();
  const router = useRouter();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<CustomFieldType>("text");
  const [optionsRaw, setOptionsRaw] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function add(): Promise<void> {
    if (busy.current || name.trim() === "") return;
    setError(null);
    const options = OPTION_TYPES.has(type)
      ? optionsRaw
          .split(/[,،]/)
          .map((label) => label.trim())
          .filter(Boolean)
          .map((label) => ({ id: crypto.randomUUID(), label }))
      : undefined;
    if (options !== undefined && options.length === 0) {
      setError(S.fieldOptionsRequired);
      return;
    }
    busy.current = true;
    setPending(true);
    onPending(true);
    try {
      const result = await createDefAction(
        { targetEntity: target, type, name: name.trim(), options },
        readCsrfToken(),
      );
      if (result.ok) {
        router.refresh();
        onCreated(result.value);
      } else setError(S.addFieldFailed);
    } catch {
      setError(S.addFieldFailed);
    } finally {
      busy.current = false;
      setPending(false);
      onPending(false);
    }
  }

  return (
    <form
      className="space-y-4"
      aria-busy={pending}
      onSubmit={(event) => {
        event.preventDefault();
        void add();
      }}
    >
      <label htmlFor={`${id}-name`} className="block space-y-1">
        <span className="text-sm font-medium">{S.fieldName}</span>
        <Input
          id={`${id}-name`}
          aria-label={S.fieldName}
          value={name}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
          disabled={pending}
          autoFocus
        />
      </label>
      <div className="space-y-1">
        <span className="text-sm font-medium">{S.fieldType}</span>
        <Select
          ariaLabel={S.fieldType}
          value={type}
          disabled={pending}
          onChange={(value) => setType(value as CustomFieldType)}
          options={CUSTOM_FIELD_TYPES.map((value) => ({
            value,
            label: settingsFieldType(S, value),
          }))}
          triggerContent={settingsFieldType(S, type)}
        />
      </div>
      {OPTION_TYPES.has(type) && (
        <label htmlFor={`${id}-options`} className="block space-y-1">
          <span className="text-sm font-medium">{S.fieldOptions}</span>
          <Input
            id={`${id}-options`}
            aria-label={S.fieldOptions}
            value={optionsRaw}
            disabled={pending}
            onChange={(event) => setOptionsRaw(event.target.value)}
            placeholder={S.fieldOptionsHelp}
          />
        </label>
      )}
      {error !== null && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={pending}>
          {S.cancel}
        </Button>
        <Button type="submit" disabled={pending || name.trim() === ""}>
          {pending ? S.creating : S.addField}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function CreateFieldDialog({
  target,
  entityLabel,
  description,
  trigger,
  onCreated,
}: {
  target: CustomFieldTarget;
  entityLabel: string;
  description?: string;
  trigger?: ReactElement;
  onCreated: (field: CustomFieldDef) => void;
}) {
  const S = useSettingsMessages();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [scope, setScope] = useState({ target, label: entityLabel });

  function changeOpen(next: boolean): void {
    if (pending) return;
    if (next) setScope({ target, label: entityLabel });
    setOpen(next);
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>{trigger ?? <Button>{S.addField}</Button>}</DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{S.addField}</DialogTitle>
          <DialogDescription>{description ?? `${S.entity}: ${scope.label}`}</DialogDescription>
        </DialogHeader>
        {open && (
          <CreateFieldForm
            target={scope.target}
            onPending={setPending}
            onCancel={() => changeOpen(false)}
            onCreated={(field) => {
              setOpen(false);
              onCreated(field);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
