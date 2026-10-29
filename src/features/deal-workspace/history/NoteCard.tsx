"use client";
import { Ellipsis, Pin } from "lucide-react";
import type React from "react";
import { useCallback, useState } from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type CommentableEntityType, isCommentableEntityType } from "@/constants/comments";
import {
  deleteNoteAction,
  togglePinAction,
  updateNoteAction,
} from "@/features/collaboration/actions";
import { LinkifiedText } from "@/features/collaboration/LinkifiedText";
import { useDealActionError } from "@/features/deal-workspace/DealActionErrorProvider";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { readCsrfToken } from "@/utils/csrfCookie";
import { AttributionLine } from "./AttributionLine";
import { NoteComments } from "./NoteComments";

// Note card (Pipedrive parity): pale-amber body + attribution, with an always-visible
// inline Pin and a "…" menu (Edit, Delete). Edit swaps the body for a textarea; Delete
// opens a shadcn confirm Dialog. Pin/edit/delete are optimistic where cheap and call
// onChanged to invalidate the notes query on success.
export function NoteCard({
  id,
  body,
  at,
  actorName,
  pinned,
  onChanged,
  entityType,
  entityId,
}: {
  id: string;
  body: string;
  at: Date;
  actorName: string | null;
  pinned: boolean;
  onChanged?: () => void;
  entityType?: CommentableEntityType;
  entityId?: string;
}): React.ReactNode {
  const translateSales = useAppTranslations("sales");

  const [isPinned, setPinned] = useState(pinned);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(body);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const reportError = useDealActionError();

  const togglePin = useCallback(async () => {
    if (busy) return;
    const next = !isPinned;
    setBusy(true);
    setPinned(next); // optimistic
    const res = await togglePinAction({ noteId: id, pinned: next }, readCsrfToken());
    if (res.ok) onChanged?.();
    else {
      setPinned(!next); // roll back the optimistic pin
      reportError(res.error.id);
    }
    setBusy(false);
  }, [busy, isPinned, id, onChanged, reportError]);

  const save = useCallback(async () => {
    const trimmed = draft.trim();
    if (trimmed === "" || busy) return;
    setBusy(true);
    const res = await updateNoteAction({ noteId: id, body: trimmed }, readCsrfToken());
    setBusy(false);
    if (res.ok) {
      setEditing(false);
      onChanged?.();
    } else {
      reportError(res.error.id);
    }
  }, [draft, busy, id, onChanged, reportError]);

  const confirmDelete = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    const res = await deleteNoteAction({ noteId: id }, readCsrfToken());
    setBusy(false);
    if (res.ok) {
      setConfirmOpen(false);
      onChanged?.();
    } else {
      reportError(res.error.id);
    }
  }, [busy, id, onChanged, reportError]);

  const commentScope =
    isCommentableEntityType(entityType) && entityId !== undefined ? { entityType, entityId } : null;

  return (
    <div className="rounded-md border bg-warning/10 px-3 py-2 transition-colors hover:border-ring/40">
      {editing ? (
        <div>
          <textarea
            aria-label={translateSales("note_d8da2")}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            className="w-full resize-y rounded-md border bg-card px-3 py-2 text-sm outline-none focus:border-ring/50"
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setDraft(body);
                setEditing(false);
              }}
              className="rounded-md border px-3 py-1.5 text-sm transition-transform hover:bg-accent active:scale-[0.96]"
            >
              {translateSales("cancel_19766")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void save()}
              className="rounded-md bg-action px-3 py-1.5 text-sm font-medium text-action-foreground transition-transform hover:opacity-90 active:scale-[0.96] disabled:opacity-50"
            >
              {translateSales("save_1509f")}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="whitespace-pre-wrap text-pretty text-sm text-foreground">
              <LinkifiedText text={body} />
            </p>
            <AttributionLine at={at} actorName={actorName} />
          </div>
          <button
            type="button"
            aria-label={
              isPinned ? translateSales("unpin_note_0f6ed") : translateSales("pin_note_95331")
            }
            aria-pressed={isPinned}
            disabled={busy}
            onClick={() => void togglePin()}
            className={
              isPinned
                ? "shrink-0 rounded p-1 text-primary hover:bg-accent"
                : "shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            }
          >
            <Pin aria-hidden="true" className="h-4 w-4" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={translateSales("more_actions_f8d46")}
              className="relative shrink-0 rounded p-1 text-muted-foreground after:absolute after:-inset-2 after:content-[''] hover:bg-accent hover:text-foreground"
            >
              <Ellipsis aria-hidden="true" className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              aria-label={translateSales("more_actions_f8d46")}
              className="min-w-40"
            >
              <DropdownMenuItem onSelect={() => setEditing(true)}>
                {translateSales("edit_464c4")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => setConfirmOpen(true)}
                className="text-destructive focus:text-destructive"
              >
                {translateSales("delete_e2d0a")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {commentScope !== null && (
        <NoteComments
          noteId={id}
          entityType={commentScope.entityType}
          entityId={commentScope.entityId}
          onError={reportError}
        />
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{translateSales("delete_note_eecf9")}</DialogTitle>
            <DialogDescription>
              {translateSales("this_action_cannot_be_undone_3d6a4")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <button
                type="button"
                className="rounded-md border px-3 py-1.5 text-sm transition-transform hover:bg-accent active:scale-[0.96]"
              >
                {translateSales("cancel_19766")}
              </button>
            </DialogClose>
            <button
              type="button"
              disabled={busy}
              onClick={() => void confirmDelete()}
              className="rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground transition-transform hover:opacity-90 active:scale-[0.96] disabled:opacity-50"
            >
              {translateSales("delete_e2d0a")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
