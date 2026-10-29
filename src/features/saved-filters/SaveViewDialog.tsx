"use client";
import type React from "react";
import { useId, useState } from "react";
import { actionErrorContent } from "@/components/shell/actionError";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/Input";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { readCsrfToken } from "@/utils/csrfCookie";
import type { SavedView, SavedViewDefinition } from "./savedView";
import type { SavedFilterTargetEntity } from "./schemas";
import { createSavedFilterAction } from "./serverActions";

interface SaveViewDialogProps {
  targetEntity: SavedFilterTargetEntity;
  // The conditions currently applied to the list, persisted as the body of the new view.
  definition: SavedViewDefinition;
  onClose: () => void;
  onSaved: (view: SavedView) => void;
}

// Names the currently applied conditions and persists them as a saved view for this entity. The
// share checkbox is gated server-side by filter.share; a denial is surfaced here, not swallowed.
export function SaveViewDialog({
  targetEntity,
  definition,
  onClose,
  onSaved,
}: SaveViewDialogProps): React.ReactNode {
  const t = useAppTranslations("tableControls");
  const locale = useLocale();
  const nameId = useId();
  const sharedId = useId();
  const [name, setName] = useState("");
  const [isShared, setIsShared] = useState(false);
  const [errorId, setErrorId] = useState<string | null>(null);
  const error = errorId === null ? null : actionErrorContent(errorId, locale);
  const [saving, setSaving] = useState(false);

  async function save(): Promise<void> {
    const viewName = name.trim() === "" ? t("untitledView") : name.trim();
    setSaving(true);
    const res = await createSavedFilterAction(
      { name: viewName, targetEntity, definition, isShared },
      readCsrfToken(),
    );
    setSaving(false);
    if (!res.ok) {
      setErrorId(res.error.id);
      return;
    }
    onSaved({
      id: res.value.id,
      name: viewName,
      favorite: false,
      isShared,
      isOwn: true,
      definition,
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent aria-describedby={undefined} className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("saveCurrentView")}</DialogTitle>
        </DialogHeader>
        <label className="block text-sm" htmlFor={nameId}>
          <span className="mb-1 block font-medium">{t("viewName")}</span>
          <Input
            id={nameId}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("viewNamePlaceholder")}
            dir="auto"
          />
        </label>
        <div className="flex items-center gap-2 text-sm">
          <Checkbox
            id={sharedId}
            label={t("sharedWithEveryone")}
            checked={isShared}
            onCheckedChange={setIsShared}
          />
          <label htmlFor={sharedId}>{t("sharedWithEveryone")}</label>
        </div>
        {error !== null && (
          <div role="alert" className="text-sm text-red-600">
            <p className="font-medium">{error.title}</p>
            <p>{error.body}</p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button size="sm" disabled={saving} onClick={() => void save()}>
            {saving ? t("saving") : t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
