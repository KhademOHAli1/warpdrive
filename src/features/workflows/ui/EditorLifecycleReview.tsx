"use client";

import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { EditorLifecycleConfirmation } from "./EditorLifecycleConfirmation";

export type EditorLifecycleRequest = {
  operation: "archive" | "unarchive" | "restore";
  versionNumber?: number;
};

export function EditorLifecycleReview({
  request,
  revision,
  dirty,
  pending,
  onOpenChange,
  onConfirm,
  onCloseAutoFocus,
}: {
  request: EditorLifecycleRequest | null;
  revision: number;
  dirty: boolean;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const t = useAppTranslations("workflows");
  if (request === null) return null;
  const copy = {
    archive: { title: t("archiveTitle"), description: t("archiveHint"), confirm: t("archive") },
    unarchive: {
      title: t("unarchiveTitle"),
      description: t("unarchiveHint"),
      confirm: t("unarchive"),
    },
    restore: {
      title: t("restoreTitle", { number: String(request.versionNumber ?? 1) }),
      description: `${t("restoreHint")} ${t("restoreRevision", { revision: String(revision) })} ${dirty ? t("restoreUnsaved") : ""}`,
      confirm: t("restoreAsDraft"),
    },
  }[request.operation];
  return (
    <EditorLifecycleConfirmation
      open
      pending={pending}
      title={copy.title}
      description={copy.description}
      confirmLabel={copy.confirm}
      cancelLabel={t("cancel")}
      onOpenChange={onOpenChange}
      onConfirm={onConfirm}
      onCloseAutoFocus={onCloseAutoFocus}
    />
  );
}
