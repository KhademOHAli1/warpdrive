import Link from "next/link";
import type { ReactNode, RefObject } from "react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import type {
  PipelineDirectoryAction,
  PipelineDirectoryError,
  PipelineDirectoryRow,
} from "./PipelineDirectory";

interface Props {
  row: PipelineDirectoryRow;
  action: PipelineDirectoryAction;
  pending: boolean;
  blocked: boolean;
  error: PipelineDirectoryError | null;
  stateChanged: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onRefresh?: () => void;
  returnFocusTo: RefObject<HTMLElement | null>;
  fallbackFocusTo: RefObject<HTMLInputElement | null>;
}

export function PipelineDirectoryDialog(props: Props): ReactNode {
  const t = useAppTranslations("pipelineLifecycle");
  const {
    row,
    action,
    pending,
    blocked,
    error,
    stateChanged,
    onConfirm,
    onCancel,
    onRefresh,
    returnFocusTo,
    fallbackFocusTo,
  } = props;
  const errorMessages: Record<PipelineDirectoryError, string> = {
    conflict: t("errorConflict"),
    denied: t("errorDenied"),
    failed: t("errorFailed"),
    unavailable: t("errorUnavailable"),
    "last-active": t("errorLastActive"),
    "default-pipeline": t("errorDefaultPipeline"),
    "fresh-auth-required": t("errorFreshAuthRequired"),
    unconfirmed: t("errorUnconfirmed"),
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onCancel();
      }}
    >
      <DialogContent
        aria-busy={pending}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (pending) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const target = returnFocusTo.current;
          if (target?.isConnected === true) target.focus();
          else fallbackFocusTo.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {action === "archive" ? t("archiveTitle") : t("restoreTitle")}:{" "}
            <bdi dir="auto">{row.name}</bdi>
          </DialogTitle>
          <DialogDescription>
            {action === "archive" ? t("archiveBody") : t("restoreBody")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <span>{t("stageCount", { count: row.stageCount })}</span>
          <span>{t("dealCount", { count: row.dealCount })}</span>
        </div>
        <p className="text-sm text-pretty text-muted-foreground">{t("historyNote")}</p>
        <p className="text-xs text-pretty text-muted-foreground">{t("accessNote")}</p>
        {(error !== null || stateChanged) && (
          <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
            <p role="alert" className="text-sm text-pretty text-destructive">
              {stateChanged ? t("stateChanged") : error === null ? "" : errorMessages[error]}
            </p>
            {error === "fresh-auth-required" && (
              <Link
                href="/settings/security"
                target="_blank"
                rel="noreferrer"
                className="block text-sm font-medium text-primary underline"
              >
                {t("verifyIdentity")}
              </Link>
            )}
            {onRefresh !== undefined ? (
              <Button size="sm" variant="outline" disabled={pending} onClick={onRefresh}>
                {t("refreshList")}
              </Button>
            ) : (
              <p className="text-xs text-pretty text-muted-foreground">{t("reloadHint")}</p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onCancel}>
            {t("cancel")}
          </Button>
          <Button disabled={blocked} onClick={onConfirm}>
            {pending
              ? t("saving")
              : action === "archive"
                ? t("confirmArchive")
                : t("confirmRestore")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
