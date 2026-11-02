"use client";

import {
  SettingsCard,
  SettingsCardBody,
  SettingsCardHeader,
} from "@/app/(app)/settings/SettingsSurface";
import { Button, buttonVariants } from "@/components/ui/Button";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { directionForLocale } from "@/features/i18n/registry";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { useFormatters } from "@/lib/useFormatters";
import { privacyRequestMessagesForLocale } from "../privacyRequestMessages";
import { privacyReviewerMessagesForLocale } from "../privacyReviewerMessages";
import type { ReviewerIntakeCardProps, ReviewerIntakeRow } from "./reviewerIntakeModel";
import { useReviewerIntake } from "./useReviewerIntake";

export type { ReviewerIntakeCardProps } from "./reviewerIntakeModel";

type Messages = ReturnType<typeof privacyReviewerMessagesForLocale>;
type IntakeTask = ReturnType<typeof useReviewerIntake>;
type IntakeSectionProps = { task: IntakeTask; L: Messages };

function IntakeRow({
  row,
  L,
  disabled,
  claim,
}: {
  row: ReviewerIntakeRow;
  L: Messages;
  disabled: boolean;
  claim: (row: ReviewerIntakeRow) => void;
}) {
  const format = useFormatters();
  const states: Record<string, string | undefined> = privacyRequestMessagesForLocale(
    useLocale(),
  ).caseStates;
  const kinds: Record<string, string | undefined> = L.kinds;
  return (
    <li className="space-y-3 rounded-md border p-4">
      <dl className="space-y-2 text-sm">
        <div>
          <dt className="text-muted-foreground">{L.reference}</dt>
          <dd>
            <bdi dir="ltr">{row.id}</bdi>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{L.kind}</dt>
          <dd>{kinds[row.kind] ?? L.unknownKind}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{L.state}</dt>
          <dd>{states[row.status] ?? L.unknownState}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{L.receivedAt}</dt>
          <dd>
            <time dateTime={new Date(row.receivedAt).toISOString()}>
              {format.dateTime(row.receivedAt)}
            </time>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{L.dueAt}</dt>
          <dd>
            {row.dueAt === null ? (
              L.noDeadline
            ) : (
              <time dateTime={new Date(row.dueAt).toISOString()}>{format.dateTime(row.dueAt)}</time>
            )}
          </dd>
        </div>
      </dl>
      <Button
        disabled={disabled || !["received", "verification_needed"].includes(row.status)}
        onClick={() => claim(row)}
      >
        {L.claim}
      </Button>
    </li>
  );
}

function IntakeControls({ task, L }: IntakeSectionProps) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={task.busy || task.unavailable} onClick={task.refresh}>
        {task.loaded ? L.refresh : L.load}
      </Button>
      {task.canRetry && (
        <Button disabled={task.busy || task.unavailable} onClick={task.retry}>
          {L.retry}
        </Button>
      )}
    </div>
  );
}

function IntakeFeedback({ task, L }: IntakeSectionProps) {
  return (
    <>
      {task.busy && (
        <p role="status" className="text-sm text-muted-foreground">
          {L.loading}
        </p>
      )}
      {task.error !== null && (
        <p role="alert" className="text-sm text-destructive">
          {L.errors[task.error]}
        </p>
      )}
      {task.claimState === "uncertain" && (
        <p role="status" className="text-sm">
          {L.uncertain}
        </p>
      )}
      {task.needsFresh && task.engaged && (
        <div className="space-y-2">
          <a
            href="/settings/security"
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: "outline" })}
          >
            {L.securityTab}
          </a>
          <p className="text-sm text-muted-foreground">{L.securityHelp}</p>
        </div>
      )}
      {!task.hideRows && task.receipt !== null && (
        <div className="space-y-2 text-sm">
          <p role="status">{L.recorded}</p>
          <p>
            {L.reference}: <bdi dir="ltr">{task.receipt.id}</bdi>
          </p>
        </div>
      )}
    </>
  );
}

function IntakeQueue({ task, L }: IntakeSectionProps) {
  if (task.hideRows) return null;
  return (
    <>
      {task.rows.length > 0 && (
        <ul className="space-y-3">
          {task.rows.map((row) => (
            <IntakeRow
              key={row.id}
              row={row}
              L={L}
              disabled={task.busy || task.intent !== null}
              claim={task.claim}
            />
          ))}
        </ul>
      )}
      {task.loaded && task.rows.length === 0 && task.error === null && (
        <p className="text-sm text-muted-foreground">{L.empty}</p>
      )}
      {task.cursor !== null && (
        <Button variant="outline" disabled={task.busy} onClick={task.more}>
          {L.more}
        </Button>
      )}
    </>
  );
}

export function ReviewerIntakeCard(props: ReviewerIntakeCardProps) {
  const locale = useLocale();
  const L = privacyReviewerMessagesForLocale(locale);
  const task = useReviewerIntake(props);
  return (
    <div dir={directionForLocale(locale)} className={`${BLOCK_CLASS} ph-no-capture`}>
      <SettingsCard>
        <SettingsCardHeader title={L.title} description={L.description} />
        <SettingsCardBody className="space-y-4">
          {task.blocked !== null ? (
            <>
              <p role="alert" className="text-sm text-destructive">
                {task.blocked === "account_changed" ? L.accountChanged : L.signedOut}
              </p>
              <a href="/settings/privacy" className={buttonVariants({ variant: "outline" })}>
                {L.reload}
              </a>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">{L.liveWarning}</p>
              <IntakeControls task={task} L={L} />
              <IntakeFeedback task={task} L={L} />
              <IntakeQueue task={task} L={L} />
            </>
          )}
        </SettingsCardBody>
      </SettingsCard>
    </div>
  );
}
