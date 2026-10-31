"use client";

import { Database, GitBranch, ListTodo } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import type { CreatableNodeType } from "../nodeFactory";

export function NodePalette({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (type: CreatableNodeType) => void;
}) {
  const t = useAppTranslations("workflows");
  const choices = [
    { type: "record.read", label: t("read"), hint: t("readActionHint"), Icon: Database },
    { type: "activity.create", label: t("task"), hint: t("taskActionHint"), Icon: ListTodo },
    { type: "condition", label: t("condition"), hint: t("conditionActionHint"), Icon: GitBranch },
  ] as const;
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("chooseNode")}</DialogTitle>
          <DialogDescription>{t("paletteHint")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {choices.map(({ type, label, hint, Icon }) => (
            <Button
              key={type}
              variant="outline"
              className="h-auto w-full justify-start gap-4 whitespace-normal p-4 text-start"
              onClick={() => onAdd(type)}
            >
              <span className="rounded-lg bg-primary/10 p-3 text-primary">
                <Icon className="size-5" />
              </span>
              <span>
                <span className="block font-semibold">{label}</span>
                <span className="mt-1 block text-xs font-normal leading-5 text-muted-foreground">
                  {hint}
                </span>
              </span>
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
