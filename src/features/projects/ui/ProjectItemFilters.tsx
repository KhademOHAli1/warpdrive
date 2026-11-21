import { ListFilter, Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/Popover";
import { Select } from "@/components/ui/Select";
import type { Locale } from "@/features/i18n/registry";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { type ProjectWorkspace, projectPriorities, projectStatuses } from "../contracts";
import {
  emptyPlanningViewFilters,
  matchesPlanningFilters,
  type PlanningScope,
  type PlanningViewFilters,
  type WorkspacePlanning,
} from "../planning/contracts";
import type { ProjectsTranslator } from "./projectMessages";
import { workflowStateLabel } from "./projectWorkflowUi";

export function filterProjectItems(
  workspace: ProjectWorkspace,
  filters: PlanningViewFilters,
  locale: Locale,
  planning?: WorkspacePlanning,
) {
  const assignments = new Map(planning?.assignments.map((entry) => [entry.itemId, entry]));
  return workspace.items.filter((item) =>
    matchesPlanningFilters(item, filters, assignments.get(item.id), locale),
  );
}

export function ProjectItemFilters({
  workspace,
  filters,
  change,
  labels,
  planning,
  planningScope,
}: {
  workspace: ProjectWorkspace;
  filters: PlanningViewFilters;
  change: (value: PlanningViewFilters) => void;
  labels: ProjectsTranslator;
  planning?: WorkspacePlanning;
  planningScope?: PlanningScope;
}) {
  const people = [workspace.project.owner, ...workspace.members.map(({ person }) => person)];
  const activeCount = Object.entries(filters).filter(
    ([key, value]) => key !== "query" && value !== "",
  ).length;
  const privacy = `${BLOCK_CLASS} ph-no-capture`;
  const groups = [
    {
      key: "status",
      all: labels("workspace.allStatuses"),
      options: [
        ...workspace.states.map((state) => ({
          value: state.id,
          label: workflowStateLabel(state, labels),
        })),
        ...projectStatuses
          .filter((status) => status === filters.status)
          .map((status) => ({ value: status, label: labels(`status.${status}`) })),
      ],
    },
    {
      key: "assignee",
      all: labels("workspace.allAssignees"),
      options: [
        { value: "unassigned", label: labels("workspace.unassigned") },
        ...people.map(({ id, name }) => ({ value: id, label: name })),
      ],
    },
    {
      key: "priority",
      all: labels("planning.allPriorities"),
      options: projectPriorities.map((priority) => ({
        value: priority,
        label: labels(`priority.${priority}`),
      })),
    },
    {
      key: "cycleId",
      all: labels("planning.allCycles"),
      options:
        planningScope?.kind === "cycles"
          ? undefined
          : planning?.cycles.map(({ id, title }) => ({ value: id, label: title })),
    },
    {
      key: "moduleId",
      all: labels("planning.allModules"),
      options:
        planningScope?.kind === "modules"
          ? undefined
          : planning?.modules.map(({ id, title }) => ({ value: id, label: title })),
    },
  ] as const;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-36 grow sm:grow-0">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute start-2 top-2 size-4 text-muted-foreground"
        />
        <Input
          className="ps-8"
          type="search"
          value={filters.query}
          placeholder={labels("workspace.search")}
          aria-label={labels("workspace.search")}
          onChange={(event) => change({ ...filters, query: event.target.value })}
        />
      </div>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            <ListFilter aria-hidden="true" className="size-4" />
            {labels("planning.filters")}
            {activeCount > 0 && <span className="rounded bg-muted px-1.5">{activeCount}</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className={`grid gap-2 ${privacy}`}>
          {groups.map(({ key, all, options }) =>
            options === undefined ? null : (
              <Select
                key={key}
                ariaLabel={
                  key === "status"
                    ? labels("workspace.filterStatus")
                    : key === "assignee"
                      ? labels("workspace.filterAssignee")
                      : all
                }
                value={filters[key]}
                contentClassName={privacy}
                options={[{ value: "", label: all }, ...options]}
                onChange={(value) => change({ ...filters, [key]: value })}
              />
            ),
          )}
        </PopoverContent>
      </Popover>
      {(activeCount > 0 || filters.query !== "") && (
        <Button size="sm" variant="ghost" onClick={() => change(emptyPlanningViewFilters)}>
          {labels("workspace.clearFilters")}
        </Button>
      )}
    </div>
  );
}
