"use client";
import type React from "react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { deleteNouns } from "./deleteNouns";

interface BulkDeleteButtonProps {
  count: number;
  // Singular and plural forms of what is being deleted, e.g. "person" / "people".
  noun: string;
  nounPlural: string;
  onConfirm: () => void;
}

// The Delete control in a bulk-action bar. Deleting a page of records is not recoverable from the
// UI, so the count is restated in the dialog: the bar showing it is what the dialog covers.
export function BulkDeleteButton({
  count,
  noun,
  nounPlural,
  onConfirm,
}: BulkDeleteButtonProps): React.ReactNode {
  const t = useAppTranslations("tableControls");
  const locale = useLocale();
  const [confirming, setConfirming] = useState(false);
  const labels = deleteNouns(noun, nounPlural, count, locale);

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-md border px-3 py-1 text-sm transition-transform hover:bg-accent active:scale-[0.96]"
      >
        {t("delete")}
      </button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("bulkDeleteTitle", { count, noun: labels.unit })}
        description={t("bulkDeleteDescription")}
        confirmLabel={t("bulkDeleteConfirm", { noun: labels.plural })}
        cancelLabel={t("cancel")}
        destructive
        onConfirm={onConfirm}
      />
    </>
  );
}
