"use client";
import type React from "react";
import { CustomFieldCell, customFieldCellClass } from "@/components/data-table/CustomFieldCell";
import type { ColumnSort } from "@/components/data-table/useColumnSort";
import { Avatar } from "@/components/ui/Avatar";
import { Checkbox } from "@/components/ui/Checkbox";
import { DEFAULT_BASE_CURRENCY } from "@/constants/currency";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { useInterfacePrefs } from "@/features/identity/InterfacePrefsProvider";
import { RecordLink } from "@/features/navigation/RecordLink";
import { useFormatters } from "@/lib/useFormatters";
import { formatUsPhone } from "@/utils/phone";
import type { PeopleColumn } from "./peopleColumns";
import type { PersonSortField } from "./schemas";

export interface PeopleListRow {
  id: string;
  name: string;
  primaryEmail: string | null;
  phone: string | null;
  orgId: string | null;
  orgName: string | null;
  // Won+lost deal count (Closed deals column); server-computed via a batched deal-count join.
  closedDeals: number;
  customFields: Record<string, unknown>;
}

// Raw persons.list row shape the load-more query returns (a subset of Person plus closedDeals).
export interface RawPersonRow {
  id: string;
  name: string;
  primaryEmail: string | null;
  phones: { value: string; primary?: boolean }[];
  orgId: string | null;
  closedDeals: number;
  customFields: Record<string, unknown>;
}

export function toRow(raw: RawPersonRow, orgNames: Record<string, string>): PeopleListRow {
  const phone = raw.phones.find((p) => p.primary === true)?.value ?? raw.phones[0]?.value ?? null;
  return {
    id: raw.id,
    name: raw.name,
    primaryEmail: raw.primaryEmail,
    phone,
    orgId: raw.orgId,
    orgName: raw.orgId !== null ? (orgNames[raw.orgId] ?? null) : null,
    closedDeals: raw.closedDeals,
    customFields: raw.customFields,
  };
}

export interface PeopleTableProps {
  rows: PeopleListRow[];
  sort: ColumnSort<PersonSortField>;
  onSort: (field: PersonSortField) => void;
  isSelected: (id: string) => boolean;
  allSelected: boolean;
  onToggleRow: (id: string) => void;
  onToggleAll: () => void;
  // Ordered visible columns (Name pinned first) + the Customize-columns cog rendered by PeopleList.
  visibleColumns: readonly PeopleColumn[];
  columnsMenu?: React.ReactNode;
  currency?: string;
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
  field: PersonSortField;
  label: string;
  sort: ColumnSort<PersonSortField>;
  onSort: (field: PersonSortField) => void;
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

// Presentational people table: header select-all + sortable Name/Email headers, and a
// per-row checkbox. Extracted from PeopleList (the data/fetch container) to keep both files
// under the project's file-size budget, mirroring LeadsTable/LeadsInbox.
function renderPersonCell(
  col: PeopleColumn,
  row: PeopleListRow,
  usPhoneFormat: boolean,
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
        <span className="flex min-w-40 items-center gap-3 font-medium">
          <Avatar name={row.name} className="size-8 shrink-0" />
          <RecordLink
            href={`/contacts/people/${row.id}`}
            preview={
              row.orgName !== null
                ? { id: row.id, title: row.name, subtitle: row.orgName }
                : { id: row.id, title: row.name }
            }
            className="text-foreground hover:text-primary hover:underline"
          >
            <bdi dir="auto">{row.name}</bdi>
          </RecordLink>
        </span>
      );
    case "org":
      return row.orgId !== null && (row.orgName ?? null) !== null ? (
        <RecordLink
          href={`/contacts/orgs/${row.orgId}`}
          preview={{ id: row.orgId, title: row.orgName ?? "" }}
          className="text-primary hover:underline"
        >
          <bdi dir="auto">{row.orgName}</bdi>
        </RecordLink>
      ) : (
        (row.orgName ?? "")
      );
    case "email":
      return row.primaryEmail === null ? (
        "—"
      ) : (
        <a href={`mailto:${row.primaryEmail}`} className="hover:text-primary hover:underline">
          <bdi dir="ltr">{row.primaryEmail}</bdi>
        </a>
      );
    case "phone":
      return row.phone === null ? (
        "—"
      ) : (
        <a
          href={`tel:${row.phone}`}
          className="whitespace-nowrap hover:text-primary hover:underline"
        >
          <bdi dir="ltr">{usPhoneFormat ? formatUsPhone(row.phone) : row.phone}</bdi>
        </a>
      );
    case "closedDeals":
      return number(row.closedDeals);
    default:
      return "";
  }
}

function cellClass(col: PeopleColumn): string {
  if (col.customField !== undefined) return customFieldCellClass(col.customField);
  if (col.key === "phone" || col.key === "closedDeals")
    return "px-4 py-[var(--row-py)] tabular-nums text-muted-foreground";
  if (col.key === "name") return "px-4 py-[var(--row-py)]";
  return "px-4 py-[var(--row-py)] text-muted-foreground";
}

export function PeopleTable({
  rows,
  sort,
  onSort,
  isSelected,
  allSelected,
  onToggleRow,
  onToggleAll,
  visibleColumns,
  columnsMenu,
  currency = DEFAULT_BASE_CURRENCY,
}: PeopleTableProps): React.ReactNode {
  const tContacts = useAppTranslations("contacts");
  const format = useFormatters();

  const { usPhoneFormat } = useInterfacePrefs();
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
                  label={tContacts("selectAllPeople")}
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
                    {renderPersonCell(col, row, usPhoneFormat, currency, format.number)}
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
