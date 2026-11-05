import type { WorkItem } from "../contracts";

interface WorkFilters {
  archived: boolean;
  typeId: string;
  stageId: string;
  query: string;
}
export function workItemsUrl(filters: WorkFilters, cursor: string | null): string {
  const params = new URLSearchParams({ archived: String(filters.archived) });
  if (filters.typeId !== "") params.set("typeId", filters.typeId);
  if (filters.stageId !== "") params.set("stageId", filters.stageId);
  if (filters.query !== "") params.set("q", filters.query);
  if (cursor !== null) params.set("cursor", cursor);
  return `/api/work-profile/items?${params.toString()}`;
}

export function mergeWorkRecords(pages: WorkItem[], updates: WorkItem[]): WorkItem[] {
  const records = new Map(pages.map((item) => [item.id, item]));
  for (const item of updates) {
    if ((records.get(item.id)?.revision ?? -1) <= item.revision) records.set(item.id, item);
  }
  return [...records.values()];
}

export function matchWorkFilters(items: WorkItem[], filters: WorkFilters): WorkItem[] {
  const query = filters.query.toLocaleLowerCase();
  return items.filter(
    (item) =>
      item.isArchived === filters.archived &&
      (filters.typeId === "" || item.typeId === filters.typeId) &&
      (filters.stageId === "" || item.stageId === filters.stageId) &&
      (query === "" || `${item.title} ${item.description}`.toLocaleLowerCase().includes(query)),
  );
}
