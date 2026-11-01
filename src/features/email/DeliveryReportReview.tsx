"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select } from "@/components/ui/Select";
import { useAppTranslations, useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { formatDateTime } from "@/lib/localeFormatting";
import type {
  DeliveryObservationError,
  DeliveryObservationView,
  DeliveryRecipientView,
  DeliveryReportsPanelProps,
  DeliveryReviewInput,
  DeliveryReviewState,
} from "./deliveryObservationTypes";

interface ReviewProps extends Pick<DeliveryReportsPanelProps, "targets" | "onReview"> {
  report: DeliveryObservationView;
  recipient: DeliveryRecipientView;
  review: DeliveryReviewState;
  onSaved: (review: DeliveryReviewState) => void;
}

export function DeliveryReportReview({
  report,
  recipient,
  review,
  targets,
  onReview,
  onSaved,
}: ReviewProps) {
  const t = useAppTranslations("deliveryReports");
  const preferences = useLocalePreferences();
  const checkboxId = useId();
  const [open, setOpen] = useState(false);
  const [attemptId, setAttemptId] = useState("");
  const [address, setAddress] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<DeliveryObservationError | null>(null);
  const [openedRevision, setOpenedRevision] = useState(review.revision);
  const [blocked, setBlocked] = useState<{
    revision: number;
    error: DeliveryObservationError;
  } | null>(null);
  const submitting = useRef(false);
  const currentRevision = useRef(review.revision);
  useLayoutEffect(() => {
    currentRevision.current = review.revision;
  }, [review.revision]);
  const selected = targets.find((target) => target.attemptId === attemptId);
  const selectedRecipient = selected?.recipients.find((entry) => entry.address === address);
  const changed = open && openedRevision !== review.revision;
  const activeBlock = blocked !== null && blocked.revision === review.revision;
  const visibleError = changed ? "conflict" : activeBlock ? blocked.error : error;
  const locked = changed || activeBlock;
  const disabled = busy || locked;
  const targetTime = (iso: string) =>
    formatDateTime(new Date(iso), preferences, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "short",
    });

  function changeOpen(next: boolean) {
    if (submitting.current) return;
    setOpen(next);
    if (next) {
      setOpenedRevision(review.revision);
      if (blocked !== null && blocked.revision !== review.revision) setBlocked(null);
      setAttemptId("");
      setAddress("");
      setConfirmed(false);
      setError(null);
    }
  }

  async function save(decision: "associate" | "dismiss") {
    if (submitting.current || locked || openedRevision !== currentRevision.current || !confirmed)
      return;
    if (decision === "associate" && selectedRecipient === undefined) return;
    const base = {
      reportId: report.id,
      recipientIndex: recipient.index,
      expectedRevision: openedRevision,
      confirmUnverified: true as const,
    };
    const input: DeliveryReviewInput =
      decision === "dismiss"
        ? { ...base, decision }
        : { ...base, decision, target: { attemptId, recipient: address } };
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await onReview(input);
      if (currentRevision.current !== input.expectedRevision) {
        setBlocked({ revision: input.expectedRevision, error: "conflict" });
        return;
      }
      if (!result.ok) {
        if (
          result.error === "permission" ||
          result.error === "conflict" ||
          result.error === "not_found"
        )
          setBlocked({ revision: input.expectedRevision, error: result.error });
        else setError(result.error);
        return;
      }
      onSaved(result.value);
      setOpen(false);
    } catch {
      setError("unknown");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          {t("review")}
        </Button>
      </DialogTrigger>
      <DialogContent
        className="max-h-[85dvh] overflow-y-auto sm:max-w-lg"
        onEscapeKeyDown={(event) => {
          if (submitting.current) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (submitting.current) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("review")}</DialogTitle>
          <DialogDescription>{t("reviewDescription")}</DialogDescription>
        </DialogHeader>
        <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs leading-relaxed">
          <p className="font-medium">{t(`actions.${recipient.action}`)}</p>
          <p className="mt-1 break-all text-muted-foreground">
            <bdi dir="ltr">{recipient.finalRecipient.value}</bdi>
            {" · "}
            <bdi dir="ltr">{recipient.status}</bdi>
          </p>
        </div>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <p className="text-sm font-medium">{t("sentEmail")}</p>
            <Select
              ariaLabel={t("sentEmail")}
              value={attemptId}
              placeholder={t("chooseSentEmail")}
              disabled={disabled || targets.length === 0}
              options={targets.map((target) => ({
                value: target.attemptId,
                label: `${target.subject} · ${targetTime(target.sentAt)} · ${target.attemptId.slice(-8)}`,
              }))}
              onChange={(value) => {
                setAttemptId(value);
                setAddress("");
                setConfirmed(false);
                setError(null);
              }}
            />
          </div>
          {targets.length === 0 && (
            <p className="text-sm leading-relaxed text-muted-foreground">{t("noTargets")}</p>
          )}
          {selected !== undefined && (
            <fieldset aria-label={t("targetDetails")} className="min-w-0">
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 rounded-md border border-border bg-muted/20 p-3 text-xs">
                <dt className="text-muted-foreground">{t("subject")}</dt>
                <dd dir="auto" className="break-words">
                  {selected.subject}
                </dd>
                <dt className="text-muted-foreground">{t("sentAt")}</dt>
                <dd>
                  <time dateTime={selected.sentAt}>{targetTime(selected.sentAt)}</time>
                </dd>
                <dt className="text-muted-foreground">{t("reference")}</dt>
                <dd className="min-w-0 break-all font-mono">
                  <bdi dir="ltr">{selected.attemptId}</bdi>
                </dd>
              </dl>
            </fieldset>
          )}
          <div className="space-y-1.5">
            <p className="text-sm font-medium">{t("recipient")}</p>
            <Select
              ariaLabel={t("recipient")}
              value={address}
              placeholder={t("chooseRecipient")}
              disabled={disabled || selected === undefined}
              options={(selected?.recipients ?? []).map((entry) => ({
                value: entry.address,
                label: `\u2066${entry.address}\u2069 · ${t(`recipientKinds.${entry.kind}`)}`,
              }))}
              triggerContent={
                selectedRecipient === undefined ? undefined : (
                  <span className="flex min-w-0 items-center gap-2">
                    <bdi dir="ltr" className="truncate">
                      {address}
                    </bdi>
                    <span className="text-xs text-muted-foreground">
                      {t(`recipientKinds.${selectedRecipient.kind}`)}
                    </span>
                  </span>
                )
              }
              onChange={(value) => {
                setAddress(value);
                setConfirmed(false);
                setError(null);
              }}
            />
          </div>
          <label
            htmlFor={checkboxId}
            className="flex items-start gap-2 rounded-md border border-border p-3 text-sm leading-relaxed"
          >
            <Checkbox
              id={checkboxId}
              label={t("confirmation")}
              checked={confirmed}
              disabled={disabled}
              onCheckedChange={setConfirmed}
              className="mt-0.5 shrink-0"
            />
            <span>{t("confirmation")}</span>
          </label>
        </div>
        {visibleError !== null && (
          <p role="alert" className="text-sm leading-relaxed text-destructive">
            {visibleError === "conflict"
              ? t("conflict")
              : visibleError === "permission" || visibleError === "not_found"
                ? t("permission")
                : t("failure")}
          </p>
        )}
        {busy && (
          <p role="status" className="text-xs text-muted-foreground">
            {t("saving")}
          </p>
        )}
        <DialogFooter className="flex-wrap border-t pt-4">
          <Button variant="ghost" disabled={busy} onClick={() => changeOpen(false)}>
            {t("cancel")}
          </Button>
          <Button
            variant="outline"
            disabled={disabled || !confirmed}
            onClick={() => void save("dismiss")}
          >
            {t("dismiss")}
          </Button>
          <Button
            disabled={disabled || !confirmed || selectedRecipient === undefined}
            onClick={() => void save("associate")}
          >
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
