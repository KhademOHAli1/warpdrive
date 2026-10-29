"use client";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { useRouter } from "next/navigation";
import type React from "react";
import { useState } from "react";
import type { CurrencyTotal } from "@/features/currencies/money";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { useLabelColorResolver } from "@/features/labels/useLabelColorResolver";
import { DealCard } from "./DealCard";
import type { BoardCard } from "./dealRepo";
import { StageAddButton } from "./StageAddButton";
import { StageColumnHeader } from "./StageColumnHeader";

interface DraggableCardProps {
  card: BoardCard;
  rottingDays: number | null;
  density: "comfortable" | "compact";
  now: Date;
  currency?: string;
}

function DraggableCard(props: DraggableCardProps): React.ReactNode {
  const translateSales = useAppTranslations("sales");
  const { card, rottingDays, density, now, currency } = props;
  const router = useRouter();
  const resolveLabels = useLabelColorResolver("deal");
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: card.id,
    attributes: { roleDescription: translateSales("computed.draggableDeal") },
    data: { stageId: card.stageId, boardPosition: card.boardPosition },
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ opacity: isDragging ? 0.4 : undefined }}
    >
      <DealCard
        card={card}
        currency={currency}
        ownerName={card.ownerName ?? "?"}
        ownerAvatarUrl={card.ownerAvatarUrl}
        personName={card.personName ?? null}
        orgName={card.orgName ?? null}
        labels={resolveLabels(card.labels)}
        rottingDays={rottingDays}
        density={density}
        now={now}
        onOpen={() => router.push(`/deals/${card.id}`)}
      />
    </div>
  );
}

export interface BoardColumnProps {
  stageId: string;
  stageName: string;
  order: number;
  rottingDays: number | null;
  cards: BoardCard[];
  dealCount: number;
  totalValue: string;
  currencyTotals?: CurrencyTotal[];
  density: "comfortable" | "compact";
  // null until the client clock is set (see Board). Threads down to each DealCard's time visuals.
  now: Date;
  // For the per-stage add-deal button (opens the modal preset to this stage).
  pipelineId: string;
  pipelines: Array<{ id: string; name: string; stages: Array<{ id: string; name: string }> }>;
  baseCurrency?: string;
}

export function BoardColumn(props: BoardColumnProps): React.ReactNode {
  const translateSales = useAppTranslations("sales");

  const { stageId, stageName, order, rottingDays, cards, dealCount, totalValue, density, now } =
    props;
  const { pipelineId, pipelines, baseCurrency } = props;
  const { setNodeRef, isOver } = useDroppable({ id: stageId });
  // P1: local collapse state, toggled from the per-column actions menu. Session-only (no persist):
  // a rep collapses a stage to focus the board for the current session, not as a durable preference.
  const [collapsed, setCollapsed] = useState(false);

  return (
    <section
      ref={setNodeRef}
      aria-roledescription={translateSales("computed.stageColumn")}
      aria-label={stageName}
      className={[
        // Pipedrive-style lane: a tall, subtly filled column so every stage (even empty ones)
        // reads as a drop lane rather than barren white space. isOver swaps to the accent tint.
        // flex-1 + min-w lets a few stages fill the board width while many stages scroll.
        // Concentric radius: lane is rounded-xl so its 8px padding + rounded-lg cards nest cleanly
        // (outer radius > inner radius) instead of the equal-radius look that reads as "off".
        "flex min-w-72 flex-1 flex-col gap-2 overflow-hidden rounded-xl p-2 transition-colors",
        // Collapsed lanes shrink to just their header (no tall empty drop zone); expanded lanes
        // keep the min-height so even empty stages read as a drop target.
        collapsed ? "" : "min-h-96",
        isOver ? "bg-accent/60 ring-2 ring-ring/40" : "bg-muted/40",
      ]
        .join(" ")
        .trim()}
    >
      <StageColumnHeader
        pipelineId={pipelineId}
        stageId={stageId}
        stageName={stageName}
        order={order}
        pipelines={pipelines}
        baseCurrency={baseCurrency}
        dealCount={dealCount}
        totalValue={totalValue}
        currencyTotals={props.currencyTotals}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((v) => !v)}
      />

      {!collapsed && (
        <>
          <ul
            className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto"
            aria-label={translateSales("arg0_deals_33b08", { arg0: stageName })}
          >
            {cards.map((card) => (
              <li
                key={card.id}
                className="[content-visibility:auto] [contain-intrinsic-size:auto_96px]"
              >
                <DraggableCard
                  card={card}
                  currency={card.currency ?? baseCurrency}
                  rottingDays={rottingDays}
                  density={density}
                  now={now}
                />
              </li>
            ))}
          </ul>

          <StageAddButton
            pipelineId={pipelineId}
            stageId={stageId}
            pipelines={pipelines}
            baseCurrency={baseCurrency}
          />
        </>
      )}
    </section>
  );
}
