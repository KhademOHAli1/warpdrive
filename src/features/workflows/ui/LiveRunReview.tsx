"use client";

import { useId } from "react";
import { Checkbox } from "@/components/ui/Checkbox";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import type { LiveRunEffects } from "./liveRunEffectSummary";

export interface LiveRunReviewContext {
  readonly publicationName: string;
  readonly publicationNumber: number;
  readonly recordLabel: string;
  readonly effects: LiveRunEffects;
}

export function LiveRunReview({
  review,
  acknowledged,
  changed,
  disabled,
  frozen,
  onAcknowledgedChange,
}: {
  review: LiveRunReviewContext;
  acknowledged: boolean;
  changed: boolean;
  disabled: boolean;
  frozen: boolean;
  onAcknowledgedChange: (checked: boolean) => void;
}) {
  const t = useAppTranslations("workflows");
  const acknowledgementId = useId();
  const counts = [
    { label: t("start"), count: review.effects.counts.start },
    { label: t("read"), count: review.effects.counts.read },
    { label: t("task"), count: review.effects.counts.task },
    { label: t("condition"), count: review.effects.counts.condition },
    ...((review.effects.counts.filter ?? 0) > 0
      ? [{ label: t("filter"), count: review.effects.counts.filter ?? 0 }]
      : []),
    { label: t("delay"), count: review.effects.counts.delay },
  ];
  return (
    <section
      aria-label={t("liveReviewTitle")}
      className="min-w-0 space-y-3 rounded-md border p-3 text-sm"
    >
      <h3 className="font-medium">{t("liveReviewTitle")}</h3>
      <p dir="auto" className="break-words [overflow-wrap:anywhere]">
        {review.publicationName}
      </p>
      <p>{t("liveReviewVersion", { number: String(review.publicationNumber) })}</p>
      <p dir="auto" className="break-words [overflow-wrap:anywhere]">
        {t("liveReviewRecord", { name: review.recordLabel })}
      </p>
      <p>{t("liveReviewSteps", { number: String(review.effects.configuredSteps) })}</p>
      <ul className="space-y-1">
        {counts.map(({ label, count }) => (
          <li key={label} className="flex min-w-0 justify-between gap-3">
            <span>{label}</span>
            <span>{count}</span>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground">{t("liveReviewConfigured")}</p>
      {review.effects.counts.read > 0 && <p>{t("liveReviewRead")}</p>}
      {review.effects.counts.task > 0 && <p>{t("liveReviewTask")}</p>}
      {review.effects.counts.delay > 0 && <p>{t("liveReviewWait")}</p>}
      <p className="text-muted-foreground">{t("liveReviewPermissions")}</p>
      <p className="text-muted-foreground">{t("liveReviewOmitted")}</p>
      {changed && !frozen && <p role="status">{t("liveReviewChanged")}</p>}
      <label htmlFor={acknowledgementId} className="flex items-start gap-3">
        <Checkbox
          id={acknowledgementId}
          label={t("liveReviewAcknowledgement")}
          checked={acknowledged}
          disabled={disabled}
          onCheckedChange={onAcknowledgedChange}
          className="mt-0.5 shrink-0"
        />
        <span>{t("liveReviewAcknowledgement")}</span>
      </label>
    </section>
  );
}
