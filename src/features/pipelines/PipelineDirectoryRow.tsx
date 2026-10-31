import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import type { PipelineDirectoryAction, PipelineDirectoryRow } from "./PipelineDirectory";

export function PipelineDirectoryRowItem({
  row,
  canManage,
  onSelect,
}: {
  row: PipelineDirectoryRow;
  canManage: boolean;
  onSelect: (
    row: PipelineDirectoryRow,
    action: PipelineDirectoryAction,
    trigger: HTMLButtonElement,
  ) => void;
}): ReactNode {
  const t = useAppTranslations("pipelineLifecycle");
  const name = <bdi dir="auto">{row.name}</bdi>;
  return (
    <li className="flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="break-words text-sm font-medium">
          {row.isArchived ? (
            name
          ) : (
            <Link href={`/pipeline/${row.id}`} className="text-primary hover:underline">
              {name}
            </Link>
          )}
        </div>
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{t("stageCount", { count: row.stageCount })}</span>
          <span>{t("dealCount", { count: row.dealCount })}</span>
        </p>
        <p className="text-xs text-pretty text-muted-foreground">
          {row.visibility === "workspace" ? t("scopeWorkspace") : t("scopeRestricted")}
        </p>
      </div>
      {canManage && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {!row.isArchived && (
            <Link
              href={`/pipeline/${row.id}/edit`}
              className="rounded-md px-2 py-1.5 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("editStages")}
            </Link>
          )}
          <Button
            size="sm"
            variant="outline"
            aria-label={
              row.isArchived
                ? t("restoreNamed", { name: row.name })
                : t("archiveNamed", { name: row.name })
            }
            onClick={(event) =>
              onSelect(row, row.isArchived ? "restore" : "archive", event.currentTarget)
            }
          >
            {row.isArchived ? t("restore") : t("archive")}
          </Button>
        </div>
      )}
    </li>
  );
}
