"use client";
import type React from "react";
import { Tip } from "@/components/ui/tooltip";
import { funnelClip, stageSegmentStyle } from "@/features/deals/boardStageHeader";
import { useLocale } from "@/features/i18n/LocaleProvider";

// Pipedrive's signature deal-detail element: a connected chevron pipeline where
// each stage is an arrow segment. Passed stages read as "done", the current
// stage is highlighted, upcoming stages are muted. Segments interlock via a
// clip-path notch + overlap, so they connect visually with no "to" text.
export interface StageChip {
  id: string;
  name: string;
  current: boolean;
  passed: boolean;
}

// Arrow shape: flat left edge, pointed right edge, with a matching left notch on
// all but the first segment so neighbours interlock.

// Inherit the pipeline board's per-order hue ramp (stageSegmentStyle) instead of a uniform
// primary/success/muted set: each segment is tinted in its own stage color, and progress reads
// via fill intensity (passed/current deepen the hue, current bolds). See boardStageHeader.ts.
function segmentState(chip: StageChip): "current" | "passed" | "future" {
  if (chip.current) return "current";
  if (chip.passed) return "passed";
  return "future";
}

export function StageChevrons({ chips }: { chips: StageChip[] }): React.ReactNode {
  const direction = useLocale() === "fa" ? "rtl" : "ltr";
  return (
    <ol className="flex min-w-0 items-stretch overflow-hidden rounded-md">
      {chips.map((chip, idx) => {
        const fill = stageSegmentStyle(idx, segmentState(chip));
        return (
          <Tip key={chip.id} label={chip.name}>
            <li
              aria-current={chip.current ? "step" : undefined}
              className={[
                "truncate px-4 py-1 text-xs leading-5 text-foreground",
                idx > 0 ? "-ms-2 ps-6" : "",
              ]
                .join(" ")
                .trim()}
              style={{
                clipPath: funnelClip(idx === 0, direction),
                backgroundColor: fill.backgroundColor,
                fontWeight: fill.fontWeight,
              }}
            >
              <bdi dir="auto">{chip.name}</bdi>
            </li>
          </Tip>
        );
      })}
    </ol>
  );
}
