"use client";
import type React from "react";
import { CustomFieldCell, customFieldCellClass } from "@/components/data-table/CustomFieldCell";
import type { ColumnSort } from "@/components/data-table/useColumnSort";
import { Avatar } from "@/components/ui/Avatar";
import { Checkbox } from "@/components/ui/Checkbox";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { RecordLink } from "@/features/navigation/RecordLink";
import { useFormatters } from "@/lib/useFormatters";
import type { OrgColumn } from "./orgColumns";
import type { OrgSortField } from "./schemas";

export interface OrgsListRow {
  id: string;
  name: string;
  address: Record<string, unknown> | null;
  customFields: Record<string, unknown>;
  peopleCount: number;
  closedDeals: number;
  openDeals: number;
}

// Compact one-line address for the list row (e.g. "Austin, US"), not the full structured
// address (street/region/postal/coords) shown on the org detail page.
function formatAddress(address: Record<string, unknown> | null): string {
  if (address === null) return "";
  const parts = [address.city, address.country].filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
  return parts.join(", ");
}

export interface OrgsTableProps {
  rows: OrgsListRow[];
  sort: ColumnSort<OrgSortField>;
  onSort: (field: OrgSortField) => void;
  isSelected: (id: string) => boolean;
  allSelected: boolean;
  onToggleRow: (id: string) => void;
  onToggleAll: () => void;
  visibleColumns: readonly OrgColumn[];
  columnsMenu?: React.ReactNode;
  currency: string;
}

function SortGlyph({ dir }: { dir: "asc" | "desc" | null }): React.ReactNode {
  if (dir === null) return null;
  return (
    <span aria-hidden="true" className="ms-1 inline-block text-[10px]">
      {dir === "asc" ? "▲" : "▼"}
    </span>
  );
}

function SortableHeader({
  field,
  label,
  sort,
  onSort,
}: {
  field: OrgSortField;
  label: string;
  sort: ColumnSort<OrgSortField>;
  onSort: (field: OrgSortField) => void;
}): React.ReactNode {
  return (
    <th
      aria-sort={sort.field === field ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      className="px-4 py-3 text-start font-medium"
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        className="inline-flex items-center font-semibold hover:text-foreground"
      >
        {label}
        <SortGlyph dir={sort.field === field ? sort.dir : null} />
      </button>
    </th>
  );
}

// Presentational organizations table: header select-all + a sortable Name header, and a
// per-row checkbox. Extracted from OrgsList (the data/fetch container) to keep both files
// under the project's file-size budget, mirroring PeopleTable/PeopleList.
function renderOrgCell(
  col: OrgColumn,
  row: OrgsListRow,
  currency: string,
  number: (value: number) => string,
): React.ReactNode {
  if (col.customField !== undefined) {
    return (
      <CustomFieldCell
        def={col.customField}
        value={row.customFields[col.customField.key]}
        currency={currency}
      />
    );
  }
  switch (col.key) {
    case "name":
      return (
        <RecordLink
          href={`/contacts/orgs/${row.id}`}
          preview={{ id: row.id, title: row.name }}
          className="flex min-w-40 items-center gap-3 font-medium text-foreground hover:text-primary hover:underline"
        >
          <Avatar name={row.name} className="size-8 shrink-0 rounded-lg" />
          <bdi dir="auto">{row.name}</bdi>
        </RecordLink>
      );
    case "address":
      return formatAddress(row.address);
    case "peopleCount":
      return number(row.peopleCount);
    case "closedDeals":
      return number(row.closedDeals);
    case "openDeals":
      return number(row.openDeals);
    default:
      return "";
  }
}

function cellClass(col: OrgColumn): string {
  if (col.customField !== undefined) return customFieldCellClass(col.customField);
  if (col.key === "peopleCount" || col.key === "closedDeals" || col.key === "openDeals") {
    return "px-4 py-[var(--row-py)] tabular-nums text-muted-foreground";
  }
  if (col.key === "name") return "px-4 py-[var(--row-py)]";
  return "px-4 py-[var(--row-py)] text-muted-foreground";
}

export function OrgsTable({
  rows,
  sort,
  onSort,
  isSelected,
  allSelected,
  onToggleRow,
  onToggleAll,
  visibleColumns,
  columnsMenu,
  currency,
}: OrgsTableProps): React.ReactNode {
  const tContacts = useAppTranslations("contacts");
  const format = useFormatters();

  return (
    <div className="overflow-hidden">
      {columnsMenu !== undefined ? (
        <div className="flex items-center justify-end pb-1.5">{columnsMenu}</div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted/30 text-start text-xs text-muted-foreground">
              <th className="w-8 px-3 py-2">
                <Checkbox
                  label={tContacts("selectAllOrganizations")}
                  checked={allSelected}
                  onCheckedChange={onToggleAll}
                />
              </th>
              {visibleColumns.map((col) =>
                col.sortField !== undefined ? (
                  <SortableHeader
                    key={col.key}
                    field={col.sortField}
                    label={col.header}
                    sort={sort}
                    onSort={onSort}
                  />
                ) : (
                  <th key={col.key} className="px-4 py-3 text-start font-medium">
                    {col.header}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                data-state={isSelected(row.id) ? "selected" : undefined}
                className="border-b transition-colors last:border-0 hover:bg-muted/30 focus-within:bg-muted/30 data-[state=selected]:bg-primary/5"
              >
                <td className="px-3 py-2">
                  <Checkbox
                    label={tContacts("selectRecord", { name: row.name })}
                    checked={isSelected(row.id)}
                    onCheckedChange={() => onToggleRow(row.id)}
                  />
                </td>
                {visibleColumns.map((col) => (
                  <td key={col.key} className={cellClass(col)}>
                    {renderOrgCell(col, row, currency, format.number)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
