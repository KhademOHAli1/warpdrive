"use client";

import { Calculator, Database, GitBranch, Hash, Network, Plus, Search, Target } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/Popover";
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
const groups: { id: "data" | "compute" | "logic" | "output"; types: GraphNodeKind[] }[] = [
  { id: "data", types: ["metric", "constant"] },
  { id: "compute", types: ["compute"] },
  { id: "logic", types: ["compare", "logic", "branch"] },
  { id: "output", types: ["output"] },
];
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
  const [query, setQuery] = useState("");
  const matches = groups
    .map((group) => ({
      ...group,
      types: group.types.filter((type) =>
        `${L.groups[group.id]} ${L.types[type]}`
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase()),
      ),
    }))
    .filter((group) => group.types.length > 0);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" disabled={disabled}>
          <Plus className="size-3.5" aria-hidden />
          {L.add}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <div className="relative border-b p-2">
          <Search aria-hidden className="absolute start-4 top-4 size-3.5 text-muted-foreground" />
          <Input
            aria-label={L.search}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={L.search}
            className="h-8 border-0 ps-7 shadow-none"
          />
        </div>
        <div className="max-h-80 overflow-y-auto p-1.5">
          {matches.map((group) => (
            <div key={group.id} className="mb-2 last:mb-0">
              <p className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {L.groups[group.id]}
              </p>
              {group.types.map((type) => {
                const Icon = icons[type];
                return (
                  <Button
                    key={type}
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start font-normal"
                    disabled={
                      graph.nodes.length >= 40 ||
                      (type === "output" && graph.nodes.some((node) => node.type === "output"))
                    }
                    onClick={() => {
                      onAdd(type);
                      setOpen(false);
                    }}
                  >
                    <Icon className="size-3.5 text-muted-foreground" aria-hidden />
                    {L.types[type]}
                  </Button>
                );
              })}
            </div>
          ))}
          {matches.length === 0 && (
            <p className="p-3 text-xs text-muted-foreground">{L.noMatches}</p>
          )}
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
