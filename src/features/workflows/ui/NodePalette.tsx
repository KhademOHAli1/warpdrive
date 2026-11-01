"use client";

import { ArrowDown, Database, GitBranch, ListTodo, Search } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/Input";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import type { CreatableNodeType } from "../nodeFactory";

export function NodePalette({
  open,
  onClose,
  onAdd,
  context,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (type: CreatableNodeType) => void;
  context?: string;
}) {
  const t = useAppTranslations("workflows");
  const [search, setSearch] = useState("");
  const choices = [
    { type: "record.read", label: t("read"), hint: t("readActionHint"), Icon: Database },
    { type: "activity.create", label: t("task"), hint: t("taskActionHint"), Icon: ListTodo },
    { type: "condition", label: t("condition"), hint: t("conditionActionHint"), Icon: GitBranch },
  ] as const;
  const query = search.trim().toLocaleLowerCase().replaceAll("ي", "ی").replaceAll("ك", "ک");
  const matches = choices.filter((choice) =>
    `${choice.label} ${choice.hint}`.toLocaleLowerCase().includes(query),
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("chooseNode")}</DialogTitle>
          <DialogDescription>
            {t(context === undefined ? "paletteHint" : "connectedPaletteHint")}
          </DialogDescription>
        </DialogHeader>
        {context !== undefined && (
          <p className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs">
            <ArrowDown className="size-3.5 shrink-0 text-muted-foreground" />
            <bdi className="min-w-0 break-words">{context}</bdi>
          </p>
        )}
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            autoFocus
            aria-label={t("searchNodes")}
            placeholder={t("searchNodes")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="ps-9"
          />
        </div>
        <div className="space-y-2">
          {matches.map(({ type, label, hint, Icon }) => (
            <Button
              key={type}
              variant="outline"
              className="h-auto w-full justify-start gap-3 whitespace-normal p-4 text-start"
              onClick={() => onAdd(type)}
            >
              <span className="shrink-0 rounded-lg bg-primary/10 p-2.5 text-primary">
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
          {matches.length === 0 && (
            <div
              role="status"
              className="space-y-3 rounded-lg border border-dashed p-6 text-center"
            >
              <p className="text-sm text-muted-foreground">{t("noNodes")}</p>
              <Button variant="outline" size="sm" onClick={() => setSearch("")}>
                {t("clearSearch")}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
