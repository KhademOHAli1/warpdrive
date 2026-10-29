"use client";
import { useQueryClient } from "@tanstack/react-query";
import { Ellipsis } from "lucide-react";
import Link from "next/link";
import type React from "react";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { AddDealModal } from "./AddDealModal";
import { BOARD_QUERY_KEY } from "./useDealMove";

interface Option {
  id: string;
  name: string;
}

export interface StageColumnMenuProps {
  pipelineId: string;
  stageId: string;
  stageName: string;
  pipelines: Array<Option & { stages: Option[] }>;
  baseCurrency?: string;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

// P1: the per-column "Actions" menu Pipedrive reveals on stage-header hover. Warpdrive column
// headers previously had no per-column control. The column-scoped actions that make sense here:
// add a deal preset to this stage, jump to the stage editor, and collapse/expand the lane. The
// add-deal item reuses AddDealModal (same path as StageAddButton's ghost button at the lane foot).
export function StageColumnMenu(props: StageColumnMenuProps): React.ReactNode {
  const translateSales = useAppTranslations("sales");

  const { pipelineId, stageId, stageName, pipelines, baseCurrency } = props;
  const { collapsed, onToggleCollapse } = props;
  // Stage name is folded into the trigger's accessible name so screen-reader users know which
  // column's actions they are opening (multiple identical "Stage actions" triggers otherwise).
  const triggerLabel = translateSales("stageActions", { stage: stageName });
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={triggerLabel}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-[color,background-color,border-color] duration-150 hover:border-border/70 hover:bg-background/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:border-border/70 data-[state=open]:bg-background/80 data-[state=open]:text-foreground motion-reduce:transition-none"
        >
          <Ellipsis aria-hidden="true" className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          <DropdownMenuItem onSelect={() => setAddOpen(true)}>
            {translateSales("add_deal_to_this_stage_ede6a")}
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={`/pipeline/${pipelineId}/edit`}>
              {translateSales("edit_pipeline_stages_cdd1d")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onToggleCollapse}>
            {collapsed
              ? translateSales("expand_column_86f73")
              : translateSales("collapse_column_0aadc")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {addOpen && (
        <AddDealModal
          pipelineId={pipelineId}
          pipelines={pipelines}
          baseCurrency={baseCurrency}
          stageId={stageId}
          onClose={() => setAddOpen(false)}
          onCreated={() => void qc.invalidateQueries({ queryKey: BOARD_QUERY_KEY(pipelineId) })}
        />
      )}
    </>
  );
}
