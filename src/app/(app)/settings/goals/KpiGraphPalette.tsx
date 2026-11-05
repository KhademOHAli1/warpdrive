"use client";
import { Calculator, Database, GitBranch, Hash, Network, Plus, Target } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/Popover";
import { sharedKpiComputeProfiles } from "@/features/blocks/catalog";
import { BlockPalette } from "@/features/blocks/ui/BlockPalette";
import { useKpiGraphMessages } from "@/features/goals/kpiGraphMessages";
import type { KpiGraph } from "@/features/goals/kpiModel";
import type { GraphNodeKind } from "./KpiGraphModel";

const icons = {
  metric: Database,
  constant: Hash,
  compute: Calculator,
  compare: GitBranch,
  logic: Network,
  branch: GitBranch,
  output: Target,
};
function category(type: GraphNodeKind) {
  if (type === "metric" || type === "constant") return "data";
  if (type === "compute") return "compute";
  if (type === "output") return "output";
  return "logic";
}
export function KpiGraphPalette({
  graph,
  onAdd,
  onExample,
  disabled,
}: {
  graph: KpiGraph;
  onAdd: (type: GraphNodeKind) => void;
  onExample: () => void;
  disabled: boolean;
}) {
  const L = useKpiGraphMessages();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" disabled={disabled}>
          <Plus className="size-3.5" aria-hidden />
          {L.add}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <div className="max-h-96 overflow-y-auto">
          <BlockPalette
            rows={sharedKpiComputeProfiles.map((type) => {
              const Icon = icons[type];
              return {
                id: type,
                label: L.types[type],
                category: category(type),
                state:
                  graph.nodes.length >= 40 ||
                  (type === "output" && graph.nodes.some((node) => node.type === "output"))
                    ? "unavailable"
                    : "ready",
                icon: <Icon className="size-3.5 text-muted-foreground" aria-hidden />,
              };
            })}
            categories={L.groups}
            disabled={disabled}
            onChoose={(id) => {
              const type = sharedKpiComputeProfiles.find((kind) => kind === id);
              if (type !== undefined) {
                onAdd(type);
                setOpen(false);
              }
            }}
          />
        </div>
        <div className="border-t p-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-xs font-normal"
            onClick={() => {
              onExample();
              setOpen(false);
            }}
          >
            {L.winRate}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
