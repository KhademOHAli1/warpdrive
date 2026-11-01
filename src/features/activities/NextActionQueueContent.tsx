import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { useAppTranslations, useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { formatDateTime, formatNumber } from "@/lib/localeFormatting";
import type { NextActionQueueProps } from "./NextActionQueue.types";
import type { useNextActionQueueCompletion } from "./NextActionQueueCompletion";
import { NextActionQueueRowItem } from "./NextActionQueueRow";
import type { NextActionQueuePage } from "./next-action-queue/queueTypes";

function QueuePaging({
  page,
  onPageChange,
}: {
  page: NextActionQueuePage;
  onPageChange: NextActionQueueProps["onPageChange"];
}): ReactNode {
  const t = useAppTranslations("nextActionQueue");
  const preferences = useLocalePreferences();
  return (
    <footer className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
      <time dateTime={page.asOf}>
        {t("asOf", {
          time: formatDateTime(page.asOf, { ...preferences, timeZone: page.timeZone }),
        })}
      </time>
      <div className="flex flex-wrap items-center gap-2">
        {page.rows.length > 0 && (
          <span>
            {t("pageRange", {
              first: formatNumber(page.offset + 1, preferences),
              last: formatNumber(page.offset + page.rows.length, preferences),
              total: formatNumber(page.total, preferences),
            })}
          </span>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={page.offset === 0}
          onClick={() => onPageChange(Math.max(0, page.offset - page.limit))}
        >
          {t("previousPage")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={page.offset + page.limit >= page.total}
          onClick={() => onPageChange(page.offset + page.limit)}
        >
          {t("nextPage")}
        </Button>
      </div>
    </footer>
  );
}

export function NextActionQueueContent({
  page,
  callbacks,
  completion,
}: {
  page: NextActionQueuePage;
  callbacks: NextActionQueueProps;
  completion: ReturnType<typeof useNextActionQueueCompletion>;
}): ReactNode {
  const t = useAppTranslations("nextActionQueue");
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
        <span>{t("overdueCount", { count: page.counts.overdue })}</span>
        <span>{t("missingCount", { count: page.counts.missingNextStep })}</span>
        <span className="text-muted-foreground">{t("totalCount", { count: page.total })}</span>
      </div>
      {page.rows.length === 0 ? (
        <div className="space-y-3 rounded-md border bg-card p-4 text-sm">
          <p>{page.total === 0 ? t("empty") : t("emptyPage")}</p>
          {page.total > 0 && (
            <Button size="sm" variant="outline" onClick={() => callbacks.onPageChange(0)}>
              {t("firstPage")}
            </Button>
          )}
        </div>
      ) : (
        <ul className="divide-y rounded-md border bg-card">
          {page.rows.map((row) => (
            <NextActionQueueRowItem
              key={`${row.kind}:${row.id}`}
              row={row}
              timeZone={page.timeZone}
              readId={page.readId}
              state={row.kind === "activity" ? completion.stateFor(row.id) : undefined}
              pending={completion.pendingId !== null}
              callbacks={callbacks}
              submit={(reviewed) => {
                if (row.kind === "activity") void completion.submit(row, reviewed);
              }}
            />
          ))}
        </ul>
      )}
      <QueuePaging page={page} onPageChange={callbacks.onPageChange} />
    </>
  );
}
