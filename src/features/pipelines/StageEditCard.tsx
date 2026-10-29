"use client";
import { X } from "lucide-react";
import type React from "react";
import { useId } from "react";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { DEFAULT_ROTTING_DAYS } from "@/constants/pipelineDefaults";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import { normalizeNumberInput } from "@/utils/normalizeNumberInput";
import type { StageRow } from "./stageDiff";
import { dealCountLabel } from "./stageRemoval";

interface StageEditCardProps {
  row: StageRow & { dealCount: number; closedDealCount: number };
  index: number;
  canDelete: boolean;
  onChange: (patch: Partial<StageRow>) => void;
  onDelete: () => void;
  dragHandle?: React.ReactNode;
}

// One stage column in the Edit Pipeline page (each stage is a card with a name and an optional
// rotting-days threshold). Presentational: all state lives in the parent so the save-diff can
// read a single source of truth.
export function StageEditCard({
  row,
  index,
  canDelete,
  onChange,
  onDelete,
  dragHandle,
}: StageEditCardProps): React.ReactNode {
  const translateSales = useAppTranslations("sales");
  const locale = useLocale();
  const format = useFormatters();

  const rottingEnabled = row.rottingDays !== null;
  const nameId = useId();
  return (
    <div className="flex w-64 shrink-0 flex-col gap-3 rounded-lg border bg-card p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          {dragHandle}
          <span className="text-xs font-medium text-muted-foreground">
            {translateSales("computed.stageNumber", { index: index + 1 })}
          </span>
        </div>
        <button
          type="button"
          aria-label={translateSales("delete_stage_arg0_0c7b4", { arg0: index + 1 })}
          disabled={!canDelete}
          onClick={onDelete}
          className="grid size-10 -m-2 place-items-center rounded text-muted-foreground transition-transform hover:bg-accent hover:text-red-600 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>

      <div className="text-sm">
        <label htmlFor={nameId} className="mb-1 block font-medium">
          {translateSales("stage_name_1f31e")}
        </label>
        <Input
          id={nameId}
          aria-label={translateSales("stage_arg0_name_223c7", { arg0: index + 1 })}
          value={row.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          {dealCountLabel(row.dealCount, row.closedDealCount, locale)}
        </p>
      </div>

      <div className="text-sm">
        <div className="flex items-center gap-2">
          <Checkbox
            label={translateSales("stage_arg0_rotting_enabled_e5098", { arg0: index + 1 })}
            checked={rottingEnabled}
            onCheckedChange={(v) => onChange({ rottingDays: v ? DEFAULT_ROTTING_DAYS : null })}
          />
          <span className="font-medium">{translateSales("rotting_in_days_2af8a")}</span>
        </div>
        {rottingEnabled && (
          <Input
            aria-label={translateSales("stage_arg0_rotting_days_27c09", { arg0: index + 1 })}
            inputMode="numeric"
            value={format.number(row.rottingDays ?? DEFAULT_ROTTING_DAYS)}
            onChange={(e) =>
              onChange({
                rottingDays: Math.max(1, Number(normalizeNumberInput(e.target.value, locale)) || 1),
              })
            }
            className="mt-2"
          />
        )}
      </div>
    </div>
  );
}
