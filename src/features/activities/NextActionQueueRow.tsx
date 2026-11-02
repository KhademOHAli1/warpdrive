import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { useAppTranslations, useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { formatDateTime } from "@/lib/localeFormatting";
import { fmtDue } from "./dueLabel";
import type {
  NextActionQueueProps,
  QueueCompletionKind,
  QueueCompletionState,
} from "./NextActionQueue.types";
import type { NextActionQueueRow, QueueRecordLink } from "./next-action-queue/queueTypes";

interface RowActionsProps {
  row: NextActionQueueRow;
  state: QueueCompletionState | undefined;
  pending: boolean;
  callbacks: Pick<
    NextActionQueueProps,
    "onEditActivity" | "onScheduleDeal" | "onCompleteActivity" | "onRefresh"
  >;
  submit: (reviewed?: boolean) => void;
}
interface Props extends RowActionsProps {
  timeZone: string;
  readId: string;
}

function RecordLink({ record, href }: { record: QueueRecordLink | null; href: string }): ReactNode {
  return record === null ? null : (
    <Link href={href} className="break-words text-primary hover:underline">
      <bdi dir="auto">{record.label}</bdi>
    </Link>
  );
}

function QueueRecordLinks({ row }: { row: NextActionQueueRow }): ReactNode {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
      {row.kind === "activity" ? (
        <>
          <RecordLink record={row.deal} href={`/deals/${row.deal?.id ?? ""}`} />
          <RecordLink record={row.lead} href={`/leads/${row.lead?.id ?? ""}`} />
        </>
      ) : (
        <RecordLink record={row.pipeline} href={`/pipeline/${row.pipeline.id}`} />
      )}
      <RecordLink record={row.person} href={`/contacts/people/${row.person?.id ?? ""}`} />
      <RecordLink record={row.organization} href={`/contacts/orgs/${row.organization?.id ?? ""}`} />
    </div>
  );
}

function QueueRowMeta({ row, timeZone }: { row: NextActionQueueRow; timeZone: string }): ReactNode {
  const t = useAppTranslations("nextActionQueue");
  const preferences = { ...useLocalePreferences(), timeZone };
  if (row.kind === "deal")
    return (
      <>
        <p className="text-xs text-muted-foreground">
          {t("owner")}: <bdi dir="auto">{row.ownerName}</bdi>
        </p>
        <p className="text-xs text-muted-foreground">
          {row.lastActivityAt === null
            ? t("noPastActivity")
            : t("lastActivity", { time: formatDateTime(row.lastActivityAt, preferences) })}
        </p>
      </>
    );
  const due = fmtDue(row.dueAt, row.allDay, preferences, row.dueDate);
  const end =
    row.allDay && row.endDate !== null && row.endDate !== row.dueDate
      ? fmtDue(row.endAt ?? row.dueAt, true, preferences, row.endDate)
      : null;
  return (
    <>
      <p className="text-xs text-muted-foreground">
        {t("assignee")}: <bdi dir="auto">{row.assigneeName}</bdi>
      </p>
      <time dateTime={row.dueAt} className="block text-xs tabular-nums">
        {end === null ? due : `${due} – ${end}`}
      </time>
    </>
  );
}

function QueueCompletionFeedback({
  row,
  state,
  readId,
  callbacks,
  pending,
  submit,
}: Pick<Props, "row" | "state" | "readId" | "callbacks" | "pending" | "submit">): ReactNode {
  const t = useAppTranslations("nextActionQueue");
  if (state === undefined) return null;
  const messages: Partial<Record<QueueCompletionKind, string>> = {
    denied: t("actionDenied"),
    failed: t("actionFailed"),
    unconfirmed: t("actionUnconfirmed"),
  };
  const message = messages[state.kind];
  if (message === undefined) return null;
  const retryAllowed =
    state.readId !== readId &&
    row.kind === "activity" &&
    row.canComplete &&
    callbacks.onCompleteActivity !== undefined;
  return (
    <div className="space-y-2 pt-1">
      <p role="alert" className="text-sm text-pretty text-destructive">
        {message}
      </p>
      <Button size="sm" variant="outline" onClick={callbacks.onRefresh}>
        {t("refresh")}
      </Button>
      {retryAllowed && (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => submit(true)}>
          {t("retryReviewed")}
        </Button>
      )}
    </div>
  );
}

function QueueRowActions({ row, state, pending, callbacks, submit }: RowActionsProps): ReactNode {
  const t = useAppTranslations("nextActionQueue");
  if (row.kind === "deal")
    return (
      row.canSchedule && (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => callbacks.onScheduleDeal(row)}
          aria-label={t("scheduleNamed", { name: row.title })}
        >
          {t("schedule")}
        </Button>
      )
    );
  return (
    <>
      {row.canEdit && (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => callbacks.onEditActivity(row)}
          aria-label={t("editNamed", { name: row.title })}
        >
          {t("edit")}
        </Button>
      )}
      {row.canComplete && callbacks.onCompleteActivity !== undefined && (
        <Button
          size="sm"
          disabled={pending || state !== undefined}
          onClick={() => submit()}
          aria-label={t("completeNamed", { name: row.title })}
        >
          {state?.kind === "pending" ? t("saving") : t("complete")}
        </Button>
      )}
    </>
  );
}

export function NextActionQueueRowItem(props: Props): ReactNode {
  const t = useAppTranslations("nextActionQueue");
  const { row } = props;
  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1 text-sm">
        <p className="break-words font-medium">
          {row.kind === "deal" ? (
            <Link href={`/deals/${row.id}`} className="text-primary hover:underline">
              <bdi dir="auto">{row.title}</bdi>
            </Link>
          ) : (
            <bdi dir="auto">{row.title}</bdi>
          )}
        </p>
        <p className="text-xs font-medium text-muted-foreground">
          {row.reason === "overdue" ? t("overdueReason") : t("missingReason")}
        </p>
        <QueueRowMeta row={row} timeZone={props.timeZone} />
        <QueueRecordLinks row={row} />
        {row.kind === "activity" && !row.canEdit && !row.canComplete && (
          <p className="text-xs text-muted-foreground">{t("readOnly")}</p>
        )}
        <QueueCompletionFeedback {...props} />
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <QueueRowActions {...props} />
      </div>
    </li>
  );
}
