"use client";
import { useRouter } from "next/navigation";
import type React from "react";
import { useState } from "react";
import { Tip } from "@/components/ui/tooltip";
import { changeStageAction } from "@/features/deal-workspace/actions";
import { useDealActionError } from "@/features/deal-workspace/DealActionErrorProvider";
import { funnelClip, stageSegmentStyle } from "@/features/deals/boardStageHeader";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { readCsrfToken } from "@/utils/csrfCookie";

// One stage segment as rendered here. Mirrors StageChip (stageProgress.ts) but stays a local shape
// so the selector does not depend on the loader's exact type surface.
interface StageChipView {
  id: string;
  name: string;
  current: boolean;
  passed: boolean;
  days: number;
}

interface StageSelectorProps {
  dealId: string;
  // CAS precondition: the deal's updatedAt ISO string.
  expectedUpdatedAt: string;
  chips: StageChipView[];
  quiet?: boolean;
}

// Chevron shape reused from StageChevrons: flat left edge, pointed right, with a matching left
// notch on all but the first segment so neighbours interlock.

// The stage bar inherits the pipeline board's per-order hue ramp (stageSegmentStyle) rather than a
// uniform success-green / muted-gray: each segment is tinted in its own stage color, and progress
// reads via fill intensity (passed/current deepen the hue, current bolds). See boardStageHeader.ts.
function segmentState(chip: StageChipView): "current" | "passed" | "future" {
  if (chip.current) return "current";
  if (chip.passed) return "passed";
  return "future";
}

// Interactive chevron pipeline (Pipedrive parity). Each stage is a clickable option in a listbox;
// clicking a non-current stage moves the deal to it via changeStageAction (append to the bottom of
// the target column, server-side). The current stage is a no-op; all options disable while pending.
export function StageSelector({
  dealId,
  expectedUpdatedAt,
  chips,
  quiet = false,
}: StageSelectorProps): React.ReactNode {
  const translateSales = useAppTranslations("sales");
  const locale = useLocale();
  const direction = locale === "fa" ? "rtl" : "ltr";

  const router = useRouter();
  const reportError = useDealActionError();
  const [pending, setPending] = useState(false);

  async function select(chip: StageChipView): Promise<void> {
    if (chip.current || pending) return;
    setPending(true);
    const r = await changeStageAction(
      { dealId, toStageId: chip.id, expectedUpdatedAt },
      readCsrfToken(),
    );
    setPending(false);
    // Never swallow the failure: a permission denial (E_PERM_001) or a stale CAS gets a modal explaining
    // why the stage did not move, instead of a click that silently does nothing.
    if (r.ok) router.refresh();
    else reportError(r.error.id);
  }

  return (
    <div
      role="listbox"
      aria-label={translateSales("stage_de838")}
      // overflow-visible (not hidden) so the current segment can scale up and sit proud of the row.
      className="flex min-w-0 items-stretch rounded-md"
    >
      {chips.map((chip, idx) => {
        const fill = stageSegmentStyle(idx, segmentState(chip));
        return (
          <Tip key={chip.id} label={chip.name}>
            <button
              type="button"
              role="option"
              aria-selected={chip.current}
              aria-current={chip.current ? "step" : undefined}
              disabled={pending}
              onClick={() => void select(chip)}
              className={[
                "relative flex min-w-0 flex-col items-start truncate px-4 py-1 text-xs leading-tight text-foreground transition-transform hover:opacity-90 disabled:cursor-default disabled:opacity-70",
                quiet ? "shrink-0" : "",
                idx > 0 ? "-ms-2 ps-6" : "",
                // The current stage pops out of the row: slightly enlarged and raised above the
                // interlocking neighbours (which use z-0 so the scaled segment overlaps them).
                chip.current && !quiet ? "z-10 scale-[1.08] drop-shadow-sm" : "z-0",
              ]
                .join(" ")
                .trim()}
              style={{
                clipPath: funnelClip(idx === 0, direction),
                backgroundColor: quiet
                  ? chip.current
                    ? "hsl(var(--primary) / 0.12)"
                    : "hsl(var(--muted) / 0.6)"
                  : fill.backgroundColor,
                fontWeight: fill.fontWeight,
              }}
            >
              <span className="max-w-full truncate">
                <bdi dir="auto">{chip.name}</bdi>
              </span>
              {/* C3 (Pipedrive parity): day-count at 12px (PD shows day-counts only; warpdrive keeps
                the stage name above it as an extra affordance). */}
              {(!quiet || chip.current || chip.passed) && (
                <span className="text-xs tabular-nums opacity-80">
                  {translateSales("computed.dayCount", { count: chip.days })}
                </span>
              )}
            </button>
          </Tip>
        );
      })}
    </div>
  );
}
