"use client";
import type React from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";

interface StageOption {
  id: string;
  name: string;
}

interface MoveDealDialogProps {
  stages: StageOption[];
  onPick: (stageId: string) => void;
  onClose: () => void;
}

// Opened when a deal is dropped on the "Move" drag zone. Lists the current pipeline's stages so the
// user can move the deal to any stage (not just the drop-under column). Cross-pipeline move is not
// supported by moveDeal (it validates stage-in-pipeline), so this is a same-pipeline stage picker.
export function MoveDealDialog(props: MoveDealDialogProps): React.ReactNode {
  const translateSales = useAppTranslations("sales");

  const { stages, onPick, onClose } = props;

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent aria-describedby={undefined} className="max-w-sm gap-0 bg-card p-4">
        <DialogTitle className="mb-3 text-sm font-semibold">
          {translateSales("move_deal_to_stage_98133")}
        </DialogTitle>
        <ul className="flex flex-col gap-1">
          {stages.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onPick(s.id)}
                className="block w-full rounded px-2 py-1.5 text-start text-sm hover:bg-accent"
              >
                <bdi dir="auto">{s.name}</bdi>
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={onClose}
          className="mt-3 w-full rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
        >
          {translateSales("cancel_19766")}
        </button>
      </DialogContent>
    </Dialog>
  );
}
