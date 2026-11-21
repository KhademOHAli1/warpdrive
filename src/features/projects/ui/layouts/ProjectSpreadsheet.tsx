"use client";

/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Adapted from Plane v1.5.0 apps/web/components/issues/issue-layouts/spreadsheet
 * and apps/web/hooks/use-table-keyboard-navigation.ts.
 */

import { type KeyboardEvent, useRef, useState } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import {
  type ProjectItem,
  projectItemKey,
  projectItemTitleMaxLength,
  projectPriorities,
} from "../../contracts";
import { ItemAssignee, ItemStatus, type WorkItemsProps } from "../ProjectWorkItems";
import { useProjectFormatters } from "../useProjectFormatters";

type Field = "title" | "startDate" | "dueDate";

function EditableCell({
  item,
  field,
  labels,
  pending,
  updateItem,
}: WorkItemsProps & { item: ProjectItem; field: Field }) {
  const base = item[field] ?? "";
  const [value, setValue] = useState(base);
  const cancel = useRef(false);
  const isTitle = field === "title";
  const label = labels(isTitle ? "workspace.itemTitle" : `workspace.${field}`);

  async function commit() {
    if (cancel.current) {
      cancel.current = false;
      return;
    }
    const next = value.trim();
    if (value !== next) setValue(next);
    if (next === base) return;
    if (isTitle && next === "") {
      setValue(base);
      return;
    }
    const result = await updateItem(
      item,
      field === "title" ? { title: next } : { [field]: next || null },
    );
    if (!result.ok) setValue(base);
  }

  return (
    <Input
      aria-label={
        isTitle ? labels("workspace.edit", { title: item.title }) : `${label} · ${item.title}`
      }
      type={isTitle ? "text" : "date"}
      dir="auto"
      className="h-8 border-transparent bg-transparent hover:border-border focus-visible:bg-background"
      disabled={pending}
      maxLength={isTitle ? projectItemTitleMaxLength : undefined}
      min={field === "dueDate" ? (item.startDate ?? undefined) : undefined}
      max={field === "startDate" ? (item.dueDate ?? undefined) : undefined}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === "Escape") {
          if (event.key === "Escape") {
            cancel.current = true;
            setValue(base);
          }
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function moveAcrossCells(event: KeyboardEvent<HTMLTableElement>, rtl: boolean) {
  if (!event.altKey || !(event.target instanceof HTMLElement)) return;
  const cell = event.target.closest("td");
  const row = cell?.parentElement;
  if (!(cell instanceof HTMLTableCellElement) || !(row instanceof HTMLTableRowElement)) return;
  const rows = row.parentElement?.children;
  const rowIndex = [...(rows ?? [])].indexOf(row);
  if (rows === undefined || rowIndex < 0) return;
  const vertical = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
  const horizontal =
    (event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0) * (rtl ? -1 : 1);
  if (vertical === 0 && horizontal === 0) return;
  const next = rows[rowIndex + vertical]?.children[cell.cellIndex + horizontal];
  const target = next?.querySelector<HTMLElement>("input:not(:disabled),button:not(:disabled)");
  if (target === undefined || target === null) return;
  event.preventDefault();
  target.focus();
}

export function ProjectSpreadsheet(props: WorkItemsProps) {
  const { workspace, labels, pending, updateItem, openItem } = props;
  const format = useProjectFormatters();
  const columns = [
    "titleColumn",
    "statusColumn",
    "assigneeColumn",
    "priority",
    "startDate",
    "dueDate",
  ] as const;

  if (workspace.items.length === 0) {
    return (
      <EmptyState
        className="rounded-lg border bg-card"
        title={labels("workspace.empty")}
        body={labels("workspace.emptyDescription")}
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table
        aria-label={labels("layout.spreadsheet")}
        className="w-full min-w-[55rem] table-fixed text-sm"
        onKeyDown={(event) =>
          moveAcrossCells(
            event,
            event.currentTarget.closest("[dir]")?.getAttribute("dir") === "rtl",
          )
        }
      >
        <thead className="border-b bg-muted/40 text-muted-foreground">
          <tr>
            {columns.map((column, index) => (
              <th
                scope="col"
                key={column}
                className={
                  index === 0
                    ? "sticky start-0 z-10 w-[30%] border-e bg-muted px-3 py-2 text-start font-medium"
                    : "border-e px-3 py-2 text-start font-medium last:border-e-0"
                }
              >
                {labels(`workspace.${column}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {workspace.items.map((item) => (
            <tr key={item.id}>
              <td className="sticky start-0 z-10 border-e bg-card p-1">
                <div className="flex min-w-0 items-center gap-1">
                  <bdi dir="ltr" className="shrink-0 ps-1.5 text-xs text-muted-foreground">
                    {projectItemKey(workspace.project.identifier, item.sequenceNumber)}
                  </bdi>
                  {workspace.canEdit && (
                    <EditableCell key={item.revision} {...props} item={item} field="title" />
                  )}
                  <button
                    type="button"
                    className={
                      workspace.canEdit
                        ? "shrink-0 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                        : "min-w-0 truncate rounded px-2 py-1 text-start hover:text-primary"
                    }
                    aria-label={workspace.canEdit ? item.title : undefined}
                    onClick={(event) => openItem(item.id, event.currentTarget)}
                  >
                    {workspace.canEdit ? (
                      <span aria-hidden="true">↗</span>
                    ) : (
                      <bdi>{item.title}</bdi>
                    )}
                  </button>
                </div>
              </td>
              <td className="border-e p-1">
                <ItemStatus {...props} item={item} />
              </td>
              <td className="border-e p-1">
                <ItemAssignee {...props} item={item} />
              </td>
              <td className="border-e p-1">
                {workspace.canEdit ? (
                  <Select
                    ariaLabel={`${labels("workspace.priority")} · ${item.title}`}
                    disabled={pending}
                    value={item.priority}
                    options={projectPriorities.map((priority) => ({
                      value: priority,
                      label: labels(`priority.${priority}`),
                    }))}
                    onChange={(value) => {
                      const priority = projectPriorities.find((choice) => choice === value);
                      if (priority !== undefined && item.priority !== priority)
                        void updateItem(item, { priority });
                    }}
                  />
                ) : (
                  labels(`priority.${item.priority}`)
                )}
              </td>
              {(["startDate", "dueDate"] as const).map((field) => (
                <td key={field} className="border-e p-1 last:border-e-0">
                  {workspace.canEdit ? (
                    <EditableCell key={item.revision} {...props} item={item} field={field} />
                  ) : item[field] === null ? (
                    "—"
                  ) : (
                    <time dateTime={item[field]}>{format.dateOnly(item[field])}</time>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
