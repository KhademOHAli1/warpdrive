"use client";
import { type ReactNode, type RefObject, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Combobox, type ComboboxOption } from "@/components/ui/Combobox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/Input";
import { useDealActionError } from "../DealActionErrorProvider";

interface LinkSwitchDialogProps {
  open: boolean;
  currentId: string | null;
  title: string;
  label: string;
  cancelLabel: string;
  saveLabel: string;
  options: ComboboxOption[] | undefined;
  loadError?: string;
  canSave: (id: string) => boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (id: string, saveButton: HTMLButtonElement) => Promise<void>;
  menuTrigger: RefObject<HTMLButtonElement | null>;
}

export function LinkSwitchDialog({
  open,
  title,
  onOpenChange,
  onSave,
  menuTrigger,
  ...body
}: LinkSwitchDialogProps): ReactNode {
  const reportError = useDealActionError();
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  async function save(id: string, button: HTMLButtonElement): Promise<void> {
    if (inFlight.current || !body.canSave(id)) return;
    inFlight.current = true;
    setPending(true);
    try {
      await onSave(id, button);
    } catch {
      reportError(undefined, button);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!inFlight.current) onOpenChange(next);
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          const trigger = menuTrigger.current;
          if (trigger?.isConnected === true && !trigger.matches(":disabled")) {
            event.preventDefault();
            trigger.focus({ preventScroll: true });
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            <bdi dir="auto">{title}</bdi>
          </DialogTitle>
        </DialogHeader>
        <LinkSwitchBody
          {...body}
          onCancel={() => onOpenChange(false)}
          onSave={save}
          pending={pending}
        />
      </DialogContent>
    </Dialog>
  );
}

function LinkSwitchBody({
  currentId,
  label,
  cancelLabel,
  saveLabel,
  options,
  loadError,
  canSave,
  onCancel,
  onSave,
  pending,
}: Omit<LinkSwitchDialogProps, "title" | "open" | "onOpenChange" | "menuTrigger"> & {
  onCancel: () => void;
  pending: boolean;
}): ReactNode {
  const [id, setId] = useState(currentId ?? "");

  return (
    <>
      {options === undefined ? (
        <Input aria-label={label} placeholder={label} disabled readOnly />
      ) : (
        <Combobox
          ariaLabel={label}
          value={id}
          options={options}
          onChange={setId}
          disabled={pending}
          placeholder={label}
        />
      )}
      {loadError !== undefined && (
        <p role="alert" className="text-xs text-destructive">
          {loadError}
        </p>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={pending}>
          {cancelLabel}
        </Button>
        <Button
          onClick={(event) => void onSave(id, event.currentTarget)}
          disabled={pending || !canSave(id)}
        >
          {saveLabel}
        </Button>
      </DialogFooter>
    </>
  );
}
