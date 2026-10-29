"use client";
import { GraduationCap } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { Combobox } from "@/components/ui/Combobox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/Textarea";
import { useDealActionError } from "@/features/deal-workspace/DealActionErrorProvider";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { readCsrfToken } from "@/utils/csrfCookie";
import { markLostAction } from "./actions";

const COMMENT_ID = "mark-lost-comment";

export interface MarkLostDialogProps {
  dealId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lostReasonOptions: Array<{ id: string; name: string }>;
  // Called after the deal is committed lost, so the parent can refresh the server-rendered state.
  onSuccess: () => void;
}

// Pipedrive-parity "Mark as Lost" modal: a centered Dialog with a searchable preset-reason picker
// and a separate optional comment. The two coexist (a preset reason AND free-text comment can both
// be saved), matching Pipedrive, unlike the old inline row where free text was a preset fallback.
// A missing reason is allowed (marking lost never blocks). Errors surface via useDealActionError.
export function MarkLostDialog({
  dealId,
  open,
  onOpenChange,
  lostReasonOptions,
  onSuccess,
}: MarkLostDialogProps): React.ReactNode {
  const translateSales = useAppTranslations("sales");

  const reportError = useDealActionError();
  const [reasonId, setReasonId] = useState("");
  const [comment, setComment] = useState("");
  const [pending, setPending] = useState(false);

  function reset(): void {
    setReasonId("");
    setComment("");
  }

  function change(next: boolean): void {
    if (!next) reset();
    onOpenChange(next);
  }

  async function submit(): Promise<void> {
    setPending(true);
    const r = await markLostAction(
      {
        dealId,
        lostReasonId: reasonId === "" ? null : reasonId,
        lostReason: comment.trim() === "" ? null : comment.trim(),
      },
      readCsrfToken(),
    );
    setPending(false);
    if (r.ok) {
      reset();
      onOpenChange(false);
      onSuccess();
    } else {
      reportError(r.error.id);
    }
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className="max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{translateSales("mark_as_lost_a29b8")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {lostReasonOptions.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">{translateSales("lost_reason_f73d4")}</span>
              <Combobox
                ariaLabel={translateSales("lost_reason_f73d4")}
                value={reasonId}
                onChange={setReasonId}
                placeholder={translateSales("computed.noPresetReason")}
                options={[
                  { value: "", label: translateSales("computed.noPresetReason") },
                  ...lostReasonOptions.map((r) => ({ value: r.id, label: r.name })),
                ]}
              />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <label htmlFor={COMMENT_ID} className="text-sm font-medium">
              {translateSales("comments_optional_c00cc")}
            </label>
            <Textarea
              id={COMMENT_ID}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            {translateSales("manage_lost_reasons_on_the_a127f")}{" "}
            <a
              href="/settings/company/lost-reasons"
              className="text-primary underline underline-offset-2 hover:opacity-90"
            >
              {translateSales("company_settings_page_02eb2")}
            </a>
            .
          </p>
          <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
            <GraduationCap className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              {translateSales(
                "providing_a_lost_reason_can_help_you_better_understand_trends_or__04e00",
              )}
            </span>
          </div>
        </div>
        <DialogFooter>
          <button
            type="button"
            onClick={() => change(false)}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
          >
            {translateSales("cancel_19766")}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => void submit()}
            className="rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground transition-[opacity,scale] duration-150 ease-out hover:opacity-90 active:not-disabled:scale-[0.96] disabled:opacity-50"
          >
            {translateSales("mark_as_lost_9a070")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
