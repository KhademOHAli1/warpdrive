"use client";

import { Redo2, Undo2 } from "lucide-react";
import type { KeyboardEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Tip } from "@/components/ui/tooltip";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";

export type GraphHistoryControls = {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
};
export function handleHistoryKey(
  event: KeyboardEvent,
  history: GraphHistoryControls | undefined,
  editable: boolean,
) {
  if (!editable || history === undefined || !(event.metaKey || event.ctrlKey) || event.altKey)
    return;
  const target = event.target;
  if (
    target instanceof Element &&
    target.closest("input,textarea,select,[contenteditable=true],[role=combobox]")
  )
    return;
  const key = event.key.toLowerCase();
  if (key !== "z" && !(key === "y" && !event.metaKey)) return;
  event.preventDefault();
  if (event.shiftKey || key === "y") history.redo();
  else history.undo();
}
export function HistoryControls({
  history,
  editable,
}: {
  history: GraphHistoryControls;
  editable: boolean;
}) {
  const t = useAppTranslations("workflows");
  return (
    <div className="flex gap-1 border-e pe-2">
      <Tip label={t("undoHint")}>
        <Button
          variant="ghost"
          size="sm"
          aria-label={t("undo")}
          disabled={!editable || !history.canUndo}
          onClick={history.undo}
        >
          <Undo2 className="size-4" />
        </Button>
      </Tip>
      <Tip label={t("redoHint")}>
        <Button
          variant="ghost"
          size="sm"
          aria-label={t("redo")}
          disabled={!editable || !history.canRedo}
          onClick={history.redo}
        >
          <Redo2 className="size-4" />
        </Button>
      </Tip>
    </div>
  );
}
