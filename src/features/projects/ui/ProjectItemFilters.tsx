import { Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { Locale } from "@/features/i18n/registry";
import { type ProjectWorkspace, projectStatuses } from "../contracts";
import type { ProjectsTranslator } from "./projectMessages";

export const defaultProjectItemFilters = { query: "", status: "", assignee: "" };
export type ProjectFilters = typeof defaultProjectItemFilters;

export function filterProjectItems(
  workspace: ProjectWorkspace,
  filters: ProjectFilters,
  locale: Locale,
) {
  const query = filters.query.trim().toLocaleLowerCase(locale);
  return workspace.items.filter(
    (item) =>
      (filters.status === "" || item.status === filters.status) &&
      (filters.assignee === "" || (item.assigneeId ?? "unassigned") === filters.assignee) &&
      item.title.toLocaleLowerCase(locale).includes(query),
  );
}

export function ProjectItemFilters({
  workspace,
  filters,
  change,
  labels,
}: {
  workspace: ProjectWorkspace;
  filters: ProjectFilters;
  change: (value: ProjectFilters) => void;
  labels: ProjectsTranslator;
}) {
  const people = [workspace.project.owner, ...workspace.members.map(({ person }) => person)];
  const hasFilters = filters.query !== "" || filters.status !== "" || filters.assignee !== "";
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
      <div className="min-w-32 grow sm:grow-0">
        <Select
          ariaLabel={labels("workspace.filterStatus")}
          value={filters.status}
          options={[
            { value: "", label: labels("workspace.allStatuses") },
            ...projectStatuses.map((status) => ({
              value: status,
              label: labels(`status.${status}`),
            })),
          ]}
          onChange={(status) => change({ ...filters, status })}
        />
      </div>
      <div className="min-w-32 grow sm:grow-0">
        <Select
          ariaLabel={labels("workspace.filterAssignee")}
          value={filters.assignee}
          options={[
            { value: "", label: labels("workspace.allAssignees") },
            { value: "unassigned", label: labels("workspace.unassigned") },
            ...people.map(({ id, name }) => ({ value: id, label: name })),
          ]}
          onChange={(assignee) => change({ ...filters, assignee })}
        />
      </div>
      {hasFilters && (
        <Button size="sm" variant="ghost" onClick={() => change(defaultProjectItemFilters)}>
          {labels("workspace.clearFilters")}
        </Button>
      )}
    </div>
  );
}
