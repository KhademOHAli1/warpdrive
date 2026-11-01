"use client";

import { LockKeyhole } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { directionForLocale } from "@/features/i18n/registry";
import type {
  PrivateIntakeReviewInput,
  PrivateIntakeReviewResult,
  PrivateIntakeSummary,
} from "./privateIntakeTypes";
import { useEmailMessages } from "./useEmailMessages";
import { usePrivateIntakePanel } from "./usePrivateIntakePanel";

export interface PrivateIntakePanelProps {
  isOwner: boolean;
  // Mounted reader stacks stay alive while hidden; cancel their modal/request lifetime.
  active?: boolean;
  summary: PrivateIntakeSummary | null;
  onReview: (
    input: PrivateIntakeReviewInput,
    signal: AbortSignal,
  ) => Promise<PrivateIntakeReviewResult>;
  onReviewed?: (summary: PrivateIntakeSummary) => void;
  onRefresh?: (signal: AbortSignal) => Promise<PrivateIntakeReviewResult>;
}

function PrivateCopyReview(
  props: Omit<PrivateIntakePanelProps, "isOwner" | "summary"> & {
    summary: PrivateIntakeSummary;
  },
): React.ReactNode {
  const t = useEmailMessages().privateIntake;
  const locale = useLocale();
  const panel = usePrivateIntakePanel(props);
  const description =
    panel.summary.state === "confirmed_notification" ? t.confirmedDescription : t.description;
  const disabled = !panel.enabled || panel.busy !== null || panel.error !== null;
  const error =
    panel.error === null ? null : (
      <div className="space-y-2">
        <p role="alert" className="text-xs leading-relaxed text-muted-foreground">
          {t.errors[panel.error]}
        </p>
        {props.onRefresh !== undefined && (
          <Button
            variant="outline"
            size="sm"
            disabled={!panel.enabled || panel.busy !== null}
            onClick={() => void panel.refresh()}
          >
            {t.refresh}
          </Button>
        )}
      </div>
    );
  return (
    <section
      aria-label={t.title}
      dir={directionForLocale(locale)}
      lang={locale}
      className="mt-3 space-y-3 rounded-md border border-border bg-muted/20 p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <LockKeyhole aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <h3 className="text-sm font-medium">{t.title}</h3>
        <Badge variant="outline" className="ms-auto text-[11px] text-muted-foreground">
          {t.states[panel.summary.state]}
        </Badge>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
      {panel.summary.decision !== null && (
        <p className="text-xs text-muted-foreground">{t.decisions[panel.summary.decision]}</p>
      )}
      {panel.summary.contentState === "purged" && (
        <p className="text-xs leading-relaxed text-muted-foreground">{t.contentRemoved}</p>
      )}
      {!panel.open && error}
      {panel.saved && (
        <p role="status" className="text-xs text-muted-foreground">
          {t.saved}
        </p>
      )}
      <Dialog open={panel.open} onOpenChange={panel.setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" disabled={!panel.enabled}>
            {t.review}
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t.dialogTitle}</DialogTitle>
            <DialogDescription className="leading-relaxed">{description}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1 text-sm leading-relaxed text-muted-foreground">
            {panel.summary.state !== "confirmed_notification" && <p>{t.restrictions}</p>}
            <p>
              {panel.summary.contentState === "purged" ? t.contentRemoved : t.dismissDescription}
            </p>
            {error}
            {panel.busy !== null && (
              <p role="status">{panel.busy === "review" ? t.saving : t.refreshing}</p>
            )}
          </div>
          <DialogFooter className="flex-wrap">
            <Button variant="ghost" onClick={() => panel.setOpen(false)}>
              {t.cancel}
            </Button>
            {panel.summary.decision === "dismiss" ? (
              <Button disabled={disabled} onClick={() => void panel.review("restore_private")}>
                {t.restore}
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  disabled={disabled}
                  onClick={() => void panel.review("dismiss")}
                >
                  {t.dismiss}
                </Button>
                <Button disabled={disabled} onClick={() => void panel.review("keep_private")}>
                  {t.keepPrivate}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/** A nullable owner projection is presentation data, never authorization for native actions. */
export function PrivateIntakePanel({
  isOwner,
  summary,
  ...callbacks
}: PrivateIntakePanelProps): React.ReactNode {
  if (!isOwner || summary === null) return null;
  return <PrivateCopyReview key={summary.id} summary={summary} {...callbacks} />;
}
