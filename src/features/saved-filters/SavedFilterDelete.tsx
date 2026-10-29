"use client";
import { Trash2 } from "lucide-react";
import type React from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";

// A saved filter or view the user has asked to delete, held until they confirm.
export interface PendingFilterDelete {
  id: string;
  name: string;
  isShared: boolean;
}

// The row's delete trigger. A sibling menu item (not a button nested in the row) so it keeps its
// place in the arrow-key order and does not pick the filter, and preventDefault keeps the menu
// mounted so the confirmation it raises is not torn down with it.
export function DeleteSavedFilterItem({
  target,
  onRequest,
}: {
  target: PendingFilterDelete;
  onRequest: (target: PendingFilterDelete) => void;
}): React.ReactNode {
  const t = useAppTranslations("tableControls");
  return (
    <DropdownMenuItem
      aria-label={t("deleteNamedView", { name: target.name })}
      onSelect={(e) => {
        e.preventDefault();
        onRequest(target);
      }}
      className="shrink-0 px-1.5 text-muted-foreground focus:text-destructive"
    >
      <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
    </DropdownMenuItem>
  );
}

// One confirmation for both saved-filter menus, so the board and the record lists word it alike.
export function DeleteSavedFilterConfirm({
  pending,
  noun,
  onOpenChange,
  onConfirm,
}: {
  pending: PendingFilterDelete | null;
  // What this menu calls a row: "filter" on the board, "view" on the People/Orgs/Leads lists.
  noun: "filter" | "view";
  onOpenChange: (open: boolean) => void;
  onConfirm: (id: string) => void;
}): React.ReactNode {
  const t = useAppTranslations("tableControls");
  const locale = useLocale();
  if (pending === null) return null;
  const displayName = locale === "fa" ? `\u2068${pending.name}\u2069` : pending.name;
  // A shared row is deleted outright, so it goes for everyone who could see it.
  return (
    <ConfirmDialog
      open
      onOpenChange={onOpenChange}
      title={t(noun === "view" ? "deleteViewTitle" : "deleteFilterTitle")}
      description={t(pending.isShared ? "deleteSharedDescription" : "deletePrivateDescription", {
        name: displayName,
      })}
      confirmLabel={t("delete")}
      cancelLabel={t("cancel")}
      destructive
      onConfirm={() => onConfirm(pending.id)}
    />
  );
}
