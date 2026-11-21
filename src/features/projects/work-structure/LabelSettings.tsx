/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Adapted from Plane Community v1.5.0, apps/web/components/labels/project-setting-label-list.tsx.
 */
"use client";

import { ArrowDown, ArrowUp, ChevronDown, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { cn } from "@/lib/utils";
import {
  type ProjectLabel,
  type ProjectLabelKind,
  projectLabelsMaxCount,
  projectWorkStructureDescriptionMaxLength,
  projectWorkStructureNameMaxLength,
} from "./contracts";
import type { WorkStructureMessages } from "./messages";

function siblings(labels: ProjectLabel[], parentId: string | null) {
  return labels
    .filter((label) => label.parentId === parentId)
    .sort((left, right) => left.position - right.position);
}

function withPositions(labels: ProjectLabel[]) {
  const count = new Map<string | null, number>();
  return labels.map((label) => {
    const position = count.get(label.parentId) ?? 0;
    count.set(label.parentId, position + 1);
    return { ...label, position };
  });
}

export function LabelSettings({
  initial,
  labels,
  writable,
  pending,
  save,
}: {
  initial: ProjectLabel[];
  labels: WorkStructureMessages;
  writable: boolean;
  pending: boolean;
  save: (draft: ProjectLabel[]) => void;
}) {
  const [rows, setRows] = useState(initial);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const groups = rows.filter(({ kind }) => kind === "group");
  const trimmedQuery = query.trim().toLowerCase();
  const searched = trimmedQuery
    ? rows.filter(({ name }) => name.toLowerCase().includes(trimmedQuery))
    : [];
  const names = rows.map(({ name }) => name.trim().toLowerCase());
  const valid = names.every(Boolean) && new Set(names).size === names.length;
  const changed = JSON.stringify(rows) !== JSON.stringify(initial);
  const visible = trimmedQuery ? searched : siblings(rows, null);

  function create(kind: ProjectLabelKind, parentId: string | null) {
    if (rows.length >= projectLabelsMaxCount) return;
    setQuery("");
    const id = crypto.randomUUID();
    setRows((current) =>
      withPositions([
        ...current,
        { id, kind, parentId, position: 0, name: "", color: "#60646c", description: "" },
      ]),
    );
    if (parentId !== null)
      setCollapsed((current) => new Set([...current].filter((id) => id !== parentId)));
  }

  function update(id: string, patch: Partial<ProjectLabel>) {
    setRows((current) =>
      withPositions(current.map((row) => (row.id === id ? { ...row, ...patch } : row))),
    );
  }

  function remove(id: string) {
    setRows((current) =>
      withPositions(current.filter((row) => row.id !== id && row.parentId !== id)),
    );
  }

  function move(id: string, neighbour: string) {
    const row = rows.find((candidate) => candidate.id === id);
    const other = rows.find((candidate) => candidate.id === neighbour);
    if (row === undefined || other === undefined) return;
    setRows((current) =>
      withPositions(
        current.map((candidate) =>
          candidate.id === id ? other : candidate.id === neighbour ? row : candidate,
        ),
      ),
    );
  }

  function toggle(id: string) {
    setCollapsed((current) =>
      current.has(id)
        ? new Set([...current].filter((key) => key !== id))
        : new Set([...current, id]),
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (valid && changed && !pending) save(rows.map((row) => ({ ...row, name: row.name.trim() })));
  }

  function renderRow(row: ProjectLabel) {
    const group = siblings(rows, row.parentId);
    const index = group.findIndex(({ id }) => id === row.id);
    const previous = group[index - 1];
    const next = group[index + 1];
    return (
      <LabelRow
        key={row.id}
        row={row}
        groups={groups}
        labels={labels}
        writable={writable}
        pending={pending}
        update={(patch) => update(row.id, patch)}
        remove={() => remove(row.id)}
        moveUp={previous === undefined ? undefined : () => move(row.id, previous.id)}
        moveDown={next === undefined ? undefined : () => move(row.id, next.id)}
      />
    );
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div className="flex flex-wrap justify-between gap-3">
        <Input
          type="search"
          className="max-w-72"
          aria-label={labels.search}
          placeholder={labels.search}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {writable && rows.length < projectLabelsMaxCount && (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => create("group", null)}
            >
              {labels.addGroup}
            </Button>
            <Button type="button" disabled={pending} onClick={() => create("label", null)}>
              <Plus aria-hidden="true" /> {labels.addLabel}
            </Button>
          </div>
        )}
      </div>
      {visible.length === 0 && (
        <p className="rounded-lg border p-4 text-sm text-muted-foreground">{labels.noLabels}</p>
      )}
      <div className="space-y-2">
        {visible.map((row) =>
          row.kind === "group" && !trimmedQuery ? (
            <section key={row.id} className="rounded-lg border bg-card">
              <div className="flex items-start gap-2 p-2">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={row.name || labels.group}
                  aria-expanded={!collapsed.has(row.id)}
                  onClick={() => toggle(row.id)}
                >
                  <ChevronDown
                    aria-hidden="true"
                    className={cn("size-4", collapsed.has(row.id) && "-rotate-90 rtl:rotate-90")}
                  />
                </Button>
                <div className="min-w-0 flex-1">{renderRow(row)}</div>
              </div>
              {!collapsed.has(row.id) && (
                <div className="space-y-2 border-t p-3 ps-8">
                  {siblings(rows, row.id).map(renderRow)}
                  {writable && rows.length < projectLabelsMaxCount && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      aria-label={`${labels.addLabel} · ${row.name || labels.group}`}
                      onClick={() => create("label", row.id)}
                    >
                      <Plus aria-hidden="true" /> {labels.addLabel}
                    </Button>
                  )}
                </div>
              )}
            </section>
          ) : (
            <div key={row.id} className="rounded-lg border bg-card p-2">
              {renderRow(row)}
            </div>
          ),
        )}
      </div>
      {writable && changed && !valid && (
        <p role="alert" className="text-sm text-destructive">
          {labels.invalidLabels}
        </p>
      )}
      {writable && (
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={!valid || !changed || pending}>
            {pending ? labels.saving : labels.save}
          </Button>
          {changed && (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setRows(initial)}
            >
              {labels.reset}
            </Button>
          )}
        </div>
      )}
    </form>
  );
}

function LabelRow({
  row,
  groups,
  labels,
  writable,
  pending,
  update,
  remove,
  moveUp,
  moveDown,
}: {
  row: ProjectLabel;
  groups: ProjectLabel[];
  labels: WorkStructureMessages;
  writable: boolean;
  pending: boolean;
  update: (patch: Partial<ProjectLabel>) => void;
  remove: () => void;
  moveUp?: () => void;
  moveDown?: () => void;
}) {
  const name = row.name || (row.kind === "group" ? labels.group : labels.labels);
  if (!writable)
    return (
      <div className="flex min-h-9 items-center gap-2 text-sm">
        <span
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: row.color }}
          aria-hidden="true"
        />
        <bdi>{row.name}</bdi>
        {row.description && <bdi className="truncate text-muted-foreground">{row.description}</bdi>}
      </div>
    );
  return (
    <div className="flex flex-wrap items-start gap-2">
      <Input
        type="color"
        className="size-9 shrink-0 p-1"
        value={row.color}
        disabled={pending}
        aria-label={`${labels.color} · ${name}`}
        onChange={(event) => update({ color: event.target.value })}
      />
      <Input
        className="w-36 flex-1"
        dir="auto"
        value={row.name}
        maxLength={projectWorkStructureNameMaxLength}
        aria-label={`${labels.name} · ${name}`}
        placeholder={labels.name}
        disabled={pending}
        onChange={(event) => update({ name: event.target.value })}
      />
      {row.kind === "label" && groups.length > 0 && (
        <select
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={row.parentId ?? ""}
          aria-label={`${labels.group} · ${name}`}
          disabled={pending}
          onChange={(event) => update({ parentId: event.target.value || null })}
        >
          <option value="">{labels.noGroup}</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name || labels.group}
            </option>
          ))}
        </select>
      )}
      {moveUp !== undefined && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={pending}
          aria-label={`${labels.up} · ${name}`}
          onClick={moveUp}
        >
          <ArrowUp aria-hidden="true" />
        </Button>
      )}
      {moveDown !== undefined && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={pending}
          aria-label={`${labels.down} · ${name}`}
          onClick={moveDown}
        >
          <ArrowDown aria-hidden="true" />
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={pending}
        aria-label={`${labels.remove} · ${name}`}
        onClick={remove}
      >
        <Trash2 aria-hidden="true" />
      </Button>
      <details className="basis-full">
        <summary className="w-fit cursor-pointer text-xs text-muted-foreground">
          {labels.description}
        </summary>
        <Textarea
          className="mt-2"
          rows={2}
          dir="auto"
          value={row.description}
          disabled={pending}
          aria-label={`${labels.description} · ${name}`}
          maxLength={projectWorkStructureDescriptionMaxLength}
          onChange={(event) => update({ description: event.target.value })}
        />
      </details>
    </div>
  );
}
