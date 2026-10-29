"use client";
import type React from "react";
import type { CurrencyTotal } from "@/features/currencies/money";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { BoardColumn } from "./BoardColumn";
import type { BoardProps } from "./boardTypes";
import type { BoardCard } from "./dealRepo";

type Stage = BoardProps["stages"][number];

interface BoardStagesProps {
  stages: Stage[];
  sumsByStage: Map<string, { dealCount: number; total: number; currencyTotals?: CurrencyTotal[] }>;
  sortedByStage: Map<string, BoardCard[]>;
  density: BoardProps["density"];
  now: Date;
  pipelineId: string;
  pipelines: BoardProps["pipelines"];
  baseCurrency?: string;
}

// The horizontal list of stage columns. Extracted from Board so Board stays under the file-size
// cap; purely presentational (all board state is derived by the parent and passed in).
export function BoardStages({
  stages,
  sumsByStage,
  sortedByStage,
  density,
  now,
  pipelineId,
  pipelines,
  baseCurrency,
}: BoardStagesProps): React.ReactNode {
  const translateSales = useAppTranslations("sales");

  return (
    <ul
      aria-label={translateSales("pipeline_stages_13dad")}
      className="flex min-h-0 flex-1 list-none gap-4 overflow-x-auto pb-4"
    >
      {stages.map((s, index) => {
        const stageSum = sumsByStage.get(s.id);
        const dividerBefore = index > 0;
        return (
          <li
            key={s.id}
            data-column-divider={dividerBefore ? "true" : undefined}
            className={[
              "relative flex min-w-72 flex-1",
              dividerBefore
                ? "before:absolute before:-start-2 before:inset-y-2 before:w-px before:bg-muted-foreground/25"
                : "",
            ]
              .join(" ")
              .trim()}
          >
            <BoardColumn
              stageId={s.id}
              stageName={s.name}
              order={s.order}
              rottingDays={s.rottingDays}
              cards={sortedByStage.get(s.id) ?? []}
              dealCount={stageSum?.dealCount ?? 0}
              totalValue={String(stageSum?.total ?? 0)}
              currencyTotals={stageSum?.currencyTotals}
              density={density}
              now={now}
              pipelineId={pipelineId}
              pipelines={pipelines}
              baseCurrency={baseCurrency}
            />
          </li>
        );
      })}
    </ul>
  );
}
