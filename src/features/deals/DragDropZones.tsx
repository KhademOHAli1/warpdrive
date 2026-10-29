"use client";
import { useDroppable } from "@dnd-kit/core";
import type React from "react";
import type { DealStatus } from "@/constants/dealStatus";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { cn } from "@/lib/utils";

// Pipedrive reveals a bottom action bar during a deal drag: Lost | Won | Move, each a dashed drop
// target. Colors stay restrained: lost cautionary, won positive, the rest neutral. The bar only
// exists while a drag is active (see Board's dragActive state). Delete is deliberately NOT a drag
// target: deletion is a confirmed action on the deal/actions menu, not a drop zone.
export const DROP_ZONES = [
  { id: "deal-zone-lost", label: "Lost", tone: "text-red-600" },
  { id: "deal-zone-won", label: "Won", tone: "text-emerald-600" },
  { id: "deal-zone-move", label: "Move", tone: "text-muted-foreground" },
] as const;

// Maps a drop-zone id to the deal status transition it triggers, or null for zones that are
// not a status change (Delete, Move/Convert) and for any non-zone target (a stage id).
export function zoneToStatus(zoneId: string): "won" | "lost" | null {
  if (zoneId === "deal-zone-won") return "won";
  if (zoneId === "deal-zone-lost") return "lost";
  return null;
}

export function zoneTransition(
  zoneId: string,
  currentStatus: DealStatus | undefined,
): "won" | "lost" | null {
  const target = zoneToStatus(zoneId);
  return target === currentStatus ? null : target;
}

function Zone({ id, label, tone }: { id: string; label: string; tone: string }): React.ReactNode {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      data-drop-zone={id}
      className={cn(
        "flex-1 rounded-md border border-dashed py-3 text-center text-xs font-semibold uppercase tracking-wide transition-colors",
        tone,
        isOver ? "border-solid bg-accent/60" : "border-border",
      )}
    >
      {label}
    </div>
  );
}

export function DragDropZones({ active }: { active: boolean }): React.ReactNode {
  const translateSales = useAppTranslations("sales");

  if (!active) return null;
  return (
    <section
      aria-label={translateSales("deal_drop_actions_e2cdc")}
      className="fixed inset-x-0 bottom-0 z-40 flex gap-2 border-t bg-background/95 px-4 py-2 backdrop-blur"
    >
      {DROP_ZONES.map((z) => (
        <Zone
          key={z.id}
          id={z.id}
          label={translateSales(
            z.id === "deal-zone-won"
              ? "computed.statusWon"
              : z.id === "deal-zone-lost"
                ? "computed.statusLost"
                : "computed.move",
          )}
          tone={z.tone}
        />
      ))}
    </section>
  );
}
