/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// Adapted from Plane Community v1.5.0 (18caf808a3af3fcabeeba7d1e8473f1367bff2d4).
// apps/web/store/project/project.store.ts (filteredProjectIds) and
// apps/web/components/project/{search-projects,filters,root}.tsx.
import { Search, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { Locale } from "@/features/i18n/registry";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import type { ProjectSummary } from "../contracts";
import { PlaneDirectoryCards } from "./planeDirectoryCards";
import type { ProjectsTranslator } from "./projectMessages";

const sorts = ["newest", "oldest", "titleAscending", "titleDescending"] as const;
type DirectorySort = (typeof sorts)[number];
const dateWindows = ["7", "30", "90"] as const;
type DateWindow = (typeof dateWindows)[number];
type DateFilter = { window: DateWindow; cutoff: number };

function orderProjects(projects: ProjectSummary[], order: DirectorySort, collator: Intl.Collator) {
  const byTitle = (a: ProjectSummary, b: ProjectSummary) => collator.compare(a.title, b.title);
  const byDate = (a: ProjectSummary, b: ProjectSummary) =>
    Date.parse(a.createdAt) - Date.parse(b.createdAt);
  const compare = {
    newest: (a: ProjectSummary, b: ProjectSummary) => byDate(b, a),
    oldest: byDate,
    titleAscending: byTitle,
    titleDescending: (a: ProjectSummary, b: ProjectSummary) => byTitle(b, a),
  }[order];
  return [...projects].sort((a, b) => compare(a, b) || a.id.localeCompare(b.id));
}

export function PlaneProjectDirectory({
  projects,
  labels,
  locale,
}: {
  projects: ProjectSummary[];
  labels: ProjectsTranslator;
  locale: Locale;
}) {
  const [searchQuery, updateSearchQuery] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [dateFilter, setDateFilter] = useState<DateFilter | null>(null);
  const [order, setOrder] = useState<DirectorySort>("newest");
  const collator = new Intl.Collator(locale, { sensitivity: "base", numeric: true });
  const owners = Array.from(new Map(projects.map(({ owner }) => [owner.id, owner])).values()).sort(
    (a, b) => collator.compare(a.name, b.name) || a.id.localeCompare(b.id),
  );
  const query = searchQuery.trim().toLocaleLowerCase(locale);
  const filteredProjects = projects.filter(
    (p) =>
      (p.title.toLocaleLowerCase(locale).includes(query) ||
        p.owner.name.toLocaleLowerCase(locale).includes(query)) &&
      (ownerId === "" || p.owner.id === ownerId) &&
      (dateFilter === null || Date.parse(p.createdAt) >= dateFilter.cutoff),
  );
  const orderedProjects = orderProjects(filteredProjects, order, collator);
  const areFiltersApplied = query.length > 0 || ownerId !== "" || dateFilter !== null;

  function clearAllFilters() {
    updateSearchQuery("");
    setOwnerId("");
    setDateFilter(null);
  }

  function changeDateWindow(value: string) {
    const window = dateWindows.find((candidate) => candidate === value);
    setDateFilter(
      window === undefined
        ? null
        : {
            window,
            cutoff: Date.now() - Number(window) * 24 * 60 * 60 * 1000,
          },
    );
  }

  if (projects.length === 0) {
    return (
      <EmptyState
        className="rounded-lg border bg-card"
        title={labels("index.empty")}
        body={labels("index.emptyDescription")}
      />
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 basis-full sm:me-auto sm:basis-64">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label={labels("index.search")}
            placeholder={labels("index.search")}
            value={searchQuery}
            onChange={(event) => updateSearchQuery(event.target.value)}
            className="h-9 pe-9 ps-8 [&::-webkit-search-cancel-button]:appearance-none"
          />
          {searchQuery !== "" && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute end-1 top-1/2 size-7 -translate-y-1/2"
              aria-label={labels("index.clearSearch")}
              onClick={() => updateSearchQuery("")}
            >
              <X aria-hidden="true" className="size-4" />
            </Button>
          )}
        </div>
        <Select
          ariaLabel={labels("index.sort")}
          value={order}
          options={sorts.map((value) => ({ value, label: labels(`index.${value}`) }))}
          onChange={(value) => {
            const selected = sorts.find((candidate) => candidate === value);
            if (selected !== undefined) setOrder(selected);
          }}
          triggerClassName="h-9 w-auto min-w-32"
        />
        <Select
          ariaLabel={labels("index.ownerFilter")}
          value={ownerId}
          options={[
            { value: "", label: labels("index.allOwners") },
            ...owners.map(({ id, name }) => ({ value: id, label: name })),
          ]}
          onChange={setOwnerId}
          triggerClassName="h-9 w-auto min-w-32"
          contentClassName={`${BLOCK_CLASS} ph-no-capture`}
        />
        <Select
          ariaLabel={labels("index.dateFilter")}
          value={dateFilter?.window ?? ""}
          options={[
            { value: "", label: labels("index.allDates") },
            ...dateWindows.map((value) => ({
              value,
              label: labels("index.days", { count: Number(value) }),
            })),
          ]}
          onChange={changeDateWindow}
          triggerClassName="h-9 w-auto min-w-32"
        />
      </div>
      {areFiltersApplied && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
          <p role="status" className="text-sm text-muted-foreground">
            {labels("index.filteredCount", {
              shown: orderedProjects.length,
              total: projects.length,
            })}
          </p>
          <Button variant="ghost" size="sm" onClick={clearAllFilters}>
            {labels("index.clearFilters")}
          </Button>
        </div>
      )}
      <PlaneDirectoryCards projects={orderedProjects} labels={labels} />
    </div>
  );
}
