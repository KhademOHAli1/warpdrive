"use client";
import type React from "react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/RadioGroup";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { cn } from "@/lib/utils";
import { funnelClip, stageSegmentStyle } from "./boardStageHeader";

interface StageChevronProps {
  stages: Array<{ id: string; name: string }>;
  selectedId: string;
  onSelect: (stageId: string) => void;
}

// Pipedrive's stage picker in the Add deal dialog: a row of interlocking chevron segments, one per
// stage, with the chosen stage filled in the brand color. Built on the design-system RadioGroup so
// it gets arrow-key roving + screen-reader semantics; each stage is a RadioGroupItem rendering its
// own chevron segment (custom children, so no default radio dot).
export function StageChevron({ stages, selectedId, onSelect }: StageChevronProps): React.ReactNode {
  const translateSales = useAppTranslations("sales");
  const locale = useLocale();
  const direction = locale === "fa" ? "rtl" : "ltr";

  return (
    <RadioGroup
      value={selectedId}
      onValueChange={onSelect}
      aria-label={translateSales("pipeline_stage_8e0c5")}
      className="flex w-full gap-0 overflow-hidden"
    >
      {stages.map((s, i) => {
        const selected = s.id === selectedId;
        // Inherit the pipeline board's per-order hue (stageSegmentStyle) instead of a dark
        // primary / muted-gray pair: every stage reads in its own color, and the chosen stage
        // is emphasized with a deeper fill + bold (picker semantics, so unselected stays light).
        const fill = stageSegmentStyle(i, selected ? "current" : "future");
        return (
          <RadioGroupItem
            key={s.id}
            value={s.id}
            style={{
              clipPath: funnelClip(i === 0, direction),
              backgroundColor: fill.backgroundColor,
              fontWeight: fill.fontWeight,
            }}
            className={cn(
              "-ms-1 flex-1 truncate px-3 py-1.5 text-center text-xs text-foreground transition-opacity first:ms-0 hover:opacity-90",
            )}
          >
            <bdi dir="auto">{s.name}</bdi>
          </RadioGroupItem>
        );
      })}
    </RadioGroup>
  );
}
