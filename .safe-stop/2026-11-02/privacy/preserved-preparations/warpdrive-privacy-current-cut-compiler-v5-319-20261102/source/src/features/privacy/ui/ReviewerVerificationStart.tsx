"use client";

import { Button } from "@/components/ui/Button";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import { privacyReviewerVerificationMessagesForLocale } from "../privacyReviewerVerificationMessages";
import type { ReviewerVerificationStartTask } from "./reviewerVerificationStartModel";

export function ReviewerVerificationStart({ task }: { task: ReviewerVerificationStartTask }) {
  const L = privacyReviewerVerificationMessagesForLocale(useLocale());
  const format = useFormatters();
  if (
    task.blocked !== null ||
    (!task.canStart && task.intent === null && task.receipt === null && task.error === null)
  )
    return null;
  return (
    <section className="space-y-3 rounded-md border p-4">
      <h3 className="text-sm font-semibold">{L.title}</h3>
      <p className="text-sm text-muted-foreground">{L.warning}</p>
      {task.busy && (
        <p role="status" className="text-sm text-muted-foreground">
          {L.working}
        </p>
      )}
      {task.error !== null && (
        <p role="alert" className="text-sm text-destructive">
          {L.errors[task.error]}
        </p>
      )}
      {task.phase === "uncertain" && (
        <p role="status" className="text-sm">
          {L.uncertain}
        </p>
      )}
      {task.receipt !== null && (
        <div className="space-y-2 text-sm">
          <p role="status">{L.recorded}</p>
          <p className="text-muted-foreground">{L.historical}</p>
          <dl className="space-y-2">
            <div>
              <dt className="text-muted-foreground">{L.reference}</dt>
              <dd>
                <bdi dir="ltr">{task.receipt.id}</bdi>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{L.revision}</dt>
              <dd>{format.number(task.receipt.version)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{L.recordedStep}</dt>
              <dd>{L.verificationNeeded}</dd>
            </div>
          </dl>
        </div>
      )}
      {(task.canStart || task.intent !== null) && (
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={task.busy || (!task.canStart && !task.canRetry)}
            onClick={task.intent === null ? task.start : task.retry}
          >
            {task.intent === null ? L.start : L.retry}
          </Button>
          {task.intent !== null && (
            <Button variant="outline" disabled={!task.canClear} onClick={task.clear}>
              {L.clear}
            </Button>
          )}
        </div>
      )}
      {task.intent !== null && <p className="text-sm text-muted-foreground">{L.clearHelp}</p>}
    </section>
  );
}
