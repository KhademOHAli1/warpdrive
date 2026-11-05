"use client";

import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import {
  type HistoryModeFilter,
  type HistoryStatusFilter,
  historyModeFilters,
  historyStatusFilters,
  RUN_HISTORY_PAGE_SIZE,
} from "../runHistoryTypes";

export function RunHistoryFilters({
  status,
  mode,
  onStatus,
  onMode,
  canOlder,
  canNewest,
  onOlder,
  onNewest,
}: {
  status: HistoryStatusFilter;
  mode: HistoryModeFilter;
  onStatus: (status: HistoryStatusFilter) => void;
  onMode: (mode: HistoryModeFilter) => void;
  canOlder: boolean;
  canNewest: boolean;
  onOlder: () => void;
  onNewest: () => void;
}) {
  const t = useAppTranslations("workflows");
  const fmt = useFormatters();
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          ariaLabel={t("historyStatusFilter")}
          value={status}
          options={historyStatusFilters.map((value) => ({
            value,
            label: value === "all" ? t("historyAllStatuses") : t(`status.${value}`),
          }))}
          onChange={(raw) => {
            const next = historyStatusFilters.find((value) => value === raw);
            if (next !== undefined && next !== status) onStatus(next);
          }}
        />
        <Select
          ariaLabel={t("historyModeFilter")}
          value={mode}
          options={historyModeFilters.map((value) => ({
            value,
            label: t(
              value === "all"
                ? "historyAllModes"
                : value === "live"
                  ? "liveMode"
                  : "simulationMode",
            ),
          }))}
          onChange={(raw) => {
            const next = historyModeFilters.find((value) => value === raw);
            if (next !== undefined && next !== mode) onMode(next);
          }}
        />
      </div>
      <nav className="flex flex-wrap gap-2" aria-label={t("historyPages")}>
        <Button variant="outline" size="sm" disabled={!canNewest} onClick={onNewest}>
          {t("historyNewestRuns")}
        </Button>
        <Button variant="outline" size="sm" disabled={!canOlder} onClick={onOlder}>
          {t("historyOlderRuns")}
        </Button>
      </nav>
      <p className="text-xs text-muted-foreground">
        {t("historyPageHint", { count: fmt.number(RUN_HISTORY_PAGE_SIZE) })}
      </p>
    </div>
  );
}
