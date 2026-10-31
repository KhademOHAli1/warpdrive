"use client";

import { FolderInput, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useActionError } from "@/components/shell/ActionErrorProvider";
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
import { Select } from "@/components/ui/Select";
import { readCsrfToken } from "@/utils/csrfCookie";
import { moveThreadAction } from "./imapThreadOperationsActions";
import { useImapMoveFolders } from "./imapThreadOperationsFolders.client";
import { MailOperationHint } from "./MailOperationHint";
import { useEmailMessages } from "./useEmailMessages";

interface MoveDialogProps {
  threadId: string;
  enabled: boolean;
  onMoved: () => void;
  onRefresh?: () => void;
}

export function ImapThreadMoveDialog(props: MoveDialogProps) {
  return <ImapMoveDialogInstance key={props.threadId} {...props} />;
}

function ImapMoveDialogInstance({ threadId, enabled, onMoved, onRefresh }: MoveDialogProps) {
  const E = useEmailMessages();
  const T = E.remoteActions;
  const report = useActionError();
  const [open, setOpen] = useState(false);
  const [destination, setDestination] = useState("");
  const [failed, setFailed] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [busy, setBusy] = useState(false);
  const folderState = useImapMoveFolders(threadId);
  const { folders, loading } = folderState;
  const alive = useRef(true);
  const submitting = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const hasFailure = failed || folderState.failed;
  const selected = folders.find((folder) => folder.path === destination);

  function refresh(): void {
    folderState.cancel();
    onRefresh?.();
    setOpen(false);
    setUncertain(false);
  }
  async function submit(): Promise<void> {
    if (submitting.current || selected === undefined || uncertain) return;
    submitting.current = true;
    setBusy(true);
    setFailed(false);
    try {
      const result = await moveThreadAction(readCsrfToken(), {
        threadId,
        destinationPath: selected.path,
      });
      if (!alive.current) return;
      if (result.ok) {
        setOpen(false);
        onMoved();
      } else {
        report(result.error.id);
        setFailed(true);
        setUncertain(result.error.id === "E_MAIL_008" || result.error.id === "E_MAIL_009");
      }
    } catch {
      if (alive.current) {
        report("E_MAIL_008");
        setFailed(true);
        setUncertain(true);
      }
    } finally {
      submitting.current = false;
      if (alive.current) setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (busy) return;
        setOpen(value);
        if (value) {
          setDestination("");
          setFailed(false);
          setUncertain(false);
          folderState.reload();
        } else folderState.cancel();
      }}
    >
      <MailOperationHint enabled={enabled}>
        <DialogTrigger asChild>
          <Button type="button" variant="outline" disabled={!enabled || busy}>
            <FolderInput className="size-4" aria-hidden="true" />
            {T.move}
          </Button>
        </DialogTrigger>
      </MailOperationHint>
      <DialogContent
        aria-busy={busy}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{T.moveTitle}</DialogTitle>
          <DialogDescription>{T.moveDescription}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          {loading ? (
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              {T.loading}
            </p>
          ) : (
            <>
              <p className="text-sm font-medium">{T.folder}</p>
              <Select
                value={destination}
                onChange={setDestination}
                options={folders.map((folder) => ({ value: folder.path, label: folder.name }))}
                ariaLabel={T.folder}
                placeholder={T.chooseFolder}
                disabled={busy || uncertain || folders.length === 0}
              />
              {folders.length === 0 && !hasFailure && (
                <p className="text-sm text-muted-foreground">{T.empty}</p>
              )}
              {selected !== undefined && !selected.selected && (
                <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                  {T.outsideView}
                </p>
              )}
            </>
          )}
          {hasFailure && (
            <p role="alert" className="text-sm text-destructive">
              {uncertain ? T.refreshBeforeRetry : T.unavailable}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => {
              folderState.cancel();
              setOpen(false);
            }}
          >
            {T.cancel}
          </Button>
          {uncertain ? (
            <Button type="button" onClick={refresh}>
              {T.refresh}
            </Button>
          ) : hasFailure && folders.length === 0 ? (
            <Button
              type="button"
              onClick={() => {
                setDestination("");
                folderState.reload();
              }}
            >
              {E.workspace.retry}
            </Button>
          ) : (
            <Button
              type="button"
              disabled={loading || busy || selected === undefined}
              onClick={() => void submit()}
            >
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  {T.moving}
                </>
              ) : (
                T.confirm
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
