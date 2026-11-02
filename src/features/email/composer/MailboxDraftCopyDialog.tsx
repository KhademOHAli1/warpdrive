"use client";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useComposerMailboxMessages } from "./useComposerMailboxMessages";
export function MailboxDraftCopyDialog({
  open,
  sourceAddress,
  targetAddress,
  busy,
  error,
  onCancel,
  onConfirm,
  onReturnFocus,
}: {
  open: boolean;
  sourceAddress: string;
  targetAddress: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  onReturnFocus?: () => void;
}): React.ReactNode {
  const L = useComposerMailboxMessages();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onCancel();
      }}
    >
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (busy) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          if (onReturnFocus !== undefined) {
            event.preventDefault();
            onReturnFocus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{L.copyTitle}</DialogTitle>
          <DialogDescription>{L.copyDescription}</DialogDescription>
        </DialogHeader>
        <dl className="divide-y divide-border rounded-md border border-border text-sm">
          {[
            [L.copyFrom, sourceAddress],
            [L.copyTo, targetAddress],
          ].map(([label, address]) => (
            <div key={label} className="flex flex-wrap justify-between gap-2 px-3 py-2.5">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 break-all">
                <bdi dir="ltr">{address}</bdi>
              </dd>
            </div>
          ))}
        </dl>
        {error !== null && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {busy && (
          <p role="status" className="sr-only">
            {L.copying}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onCancel}>
            {L.cancel}
          </Button>
          <Button disabled={busy} onClick={onConfirm}>
            {busy ? L.copying : L.copyConfirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
