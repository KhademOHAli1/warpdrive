/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Adapted from Plane Community v1.5.0, apps/web/components/estimates/root.tsx.
 */
"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  type ProjectEstimatePoint,
  type ProjectEstimateScale,
  type ProjectWorkStructure,
  projectEstimatePointMaxCount,
  projectEstimatePointMaxLength,
  projectEstimatePointMinCount,
  projectEstimateScalesMaxCount,
  projectWorkStructureDescriptionMaxLength,
  projectWorkStructureNameMaxLength,
  type SaveProjectEstimateScale,
} from "./contracts";
import { projectEstimatePresets } from "./estimatePresets";
import { validProjectEstimateValue } from "./input";
import type { WorkStructureMessages } from "./messages";

export type ScaleDraft = Pick<SaveProjectEstimateScale, "scaleId" | "scale" | "replacements">;

function createPoint(value: string, position: number): ProjectEstimatePoint {
  return { id: crypto.randomUUID(), value, description: "", position };
}

export function EstimateSettings({
  catalog,
  labels,
  writable,
  pending,
  usedPoints,
  save,
  activate,
}: {
  catalog: ProjectWorkStructure;
  labels: WorkStructureMessages;
  writable: boolean;
  pending: boolean;
  usedPoints: Set<string>;
  save: (draft: ScaleDraft) => Promise<boolean>;
  activate: (id: string | null) => void;
}) {
  const [editing, setEditing] = useState<ProjectEstimateScale | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  function addScale() {
    const preset = projectEstimatePresets[0];
    setEditing({
      id: crypto.randomUUID(),
      name: labels[preset.id],
      type: preset.type,
      points: preset.values.map(createPoint),
    });
  }

  async function apply(draft: ScaleDraft) {
    if (await save(draft)) {
      setEditing(null);
      setConfirmDelete(null);
    }
  }

  return (
    <div className="space-y-4">
      {catalog.activeScaleId === null && catalog.scales.length > 0 && (
        <p className="rounded-lg border p-3 text-sm text-muted-foreground">{labels.inactive}</p>
      )}
      {writable && (
        <div className="flex flex-wrap gap-2">
          {catalog.scales.length < projectEstimateScalesMaxCount && editing === null && (
            <Button type="button" disabled={pending} onClick={addScale}>
              <Plus aria-hidden="true" /> {labels.addScale}
            </Button>
          )}
          {catalog.activeScaleId !== null && (
            <Button
              type="button"
              disabled={pending}
              variant="outline"
              onClick={() => activate(null)}
            >
              {labels.disable}
            </Button>
          )}
        </div>
      )}
      {editing !== null && (
        <EstimateScaleEditor
          key={editing.id}
          initial={editing}
          labels={labels}
          pending={pending}
          usedPoints={usedPoints}
          cancel={() => setEditing(null)}
          save={(draft) => void apply(draft)}
        />
      )}
      {catalog.scales.length === 0 && editing === null && (
        <p className="rounded-lg border p-4 text-sm text-muted-foreground">{labels.noScales}</p>
      )}
      <ul className="space-y-2">
        {catalog.scales.map((scale) => {
          const active = catalog.activeScaleId === scale.id;
          return (
            <li key={scale.id} className="space-y-2 rounded-lg border bg-card p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium">
                    <bdi>{scale.name}</bdi>
                  </h3>
                  <span className="text-sm text-muted-foreground">{labels[scale.type]}</span>
                  {active && <Badge variant="secondary">{labels.current}</Badge>}
                </div>
                {writable && (
                  <div className="flex flex-wrap gap-2">
                    {!active && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        aria-label={`${labels.activate} · ${scale.name}`}
                        onClick={() => activate(scale.id)}
                      >
                        {labels.activate}
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      aria-label={`${labels.edit} · ${scale.name}`}
                      onClick={() => setEditing(scale)}
                    >
                      {labels.edit}
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      disabled={pending}
                      aria-label={`${labels.deleteScale} · ${scale.name}`}
                      onClick={() => setConfirmDelete(scale.id)}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {scale.points.map(({ id, value, description }) => (
                  <Badge key={id} variant="outline" title={description || undefined}>
                    <bdi>{value}</bdi>
                  </Badge>
                ))}
              </div>
              {confirmDelete === scale.id && (
                <div className="flex flex-wrap items-center gap-2 border-t pt-2">
                  <p className="grow text-sm text-muted-foreground">
                    {labels.deleteScaleDescription}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => setConfirmDelete(null)}
                  >
                    {labels.cancel}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={pending}
                    onClick={() => void apply({ scaleId: scale.id, scale: null })}
                  >
                    {labels.deleteScale}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function EstimateScaleEditor({
  initial,
  labels,
  pending,
  usedPoints,
  cancel,
  save,
}: {
  initial: ProjectEstimateScale;
  labels: WorkStructureMessages;
  pending: boolean;
  usedPoints: Set<string>;
  cancel: () => void;
  save: (draft: ScaleDraft) => void;
}) {
  const nameField = useId();
  const [draft, setDraft] = useState(initial);
  const [template, setTemplate] = useState("");
  const [replacements, setReplacements] = useState<Record<string, string>>({});
  const values = draft.points.map(({ value }) =>
    draft.type === "points" ? String(Number(value)) : value.trim().toLowerCase(),
  );
  const valid =
    draft.name.trim() !== "" &&
    draft.points.length >= projectEstimatePointMinCount &&
    draft.points.every(({ value }) => validProjectEstimateValue(value.trim(), draft.type)) &&
    new Set(values).size === draft.points.length;
  const retained = new Set(draft.points.map(({ id }) => id));
  const removed = initial.points.filter(({ id }) => !retained.has(id) && usedPoints.has(id));

  function applyPreset(id: string) {
    setTemplate(id);
    const selected = projectEstimatePresets.find((preset) => preset.id === id);
    if (selected === undefined) return;
    setDraft((current) => ({
      ...current,
      type: selected.type,
      points: selected.values.map((value, position) => {
        const existing = current.points[position];
        return existing === undefined ? createPoint(value, position) : { ...existing, value };
      }),
    }));
  }

  function changePoint(id: string, patch: Partial<ProjectEstimatePoint>) {
    setDraft((current) => ({
      ...current,
      points: current.points.map((point) => (point.id === id ? { ...point, ...patch } : point)),
    }));
  }

  function move(index: number, offset: number) {
    setDraft((current) => {
      const neighbour = current.points[index + offset];
      const selected = current.points[index];
      if (neighbour === undefined || selected === undefined) return current;
      return {
        ...current,
        points: current.points.map((point, position) =>
          position === index ? neighbour : position === index + offset ? selected : point,
        ),
      };
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid || pending) return;
    const { id, name, type, points } = draft;
    const remap = removed.flatMap(({ id: pointId }) => {
      const replacementPointId = replacements[pointId];
      return replacementPointId !== undefined && retained.has(replacementPointId)
        ? [{ pointId, replacementPointId }]
        : [];
    });
    save({
      scaleId: id,
      scale: {
        name: name.trim(),
        type,
        points: points.map((point, position) => ({
          ...point,
          value: point.value.trim(),
          position,
        })),
      },
      replacements: remap,
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border bg-card p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label htmlFor={nameField} className="grid gap-1 text-sm">
          <span>{labels.name}</span>
          <Input
            id={nameField}
            dir="auto"
            value={draft.name}
            maxLength={projectWorkStructureNameMaxLength}
            disabled={pending}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span>{labels.type}</span>
          <select
            className="h-9 rounded-md border bg-background px-2"
            aria-label={labels.type}
            value={draft.type}
            disabled={pending}
            onChange={(event) => {
              const type = event.target.value === "categories" ? "categories" : "points";
              setTemplate("");
              setDraft({ ...draft, type });
            }}
          >
            <option value="points">{labels.points}</option>
            <option value="categories">{labels.categories}</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span>{labels.template}</span>
          <select
            className="h-9 rounded-md border bg-background px-2"
            aria-label={labels.template}
            value={template}
            disabled={pending}
            onChange={(event) => applyPreset(event.target.value)}
          >
            <option value="">{labels.custom}</option>
            {projectEstimatePresets.map(({ id }) => (
              <option key={id} value={id}>
                {labels[id]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset disabled={pending} className="space-y-2">
        <legend className="mb-2 text-sm font-medium">{labels.options}</legend>
        {draft.points.map((point, index) => (
          <div key={point.id} className="flex flex-wrap items-center gap-1.5">
            <Input
              className="w-20"
              dir="auto"
              value={point.value}
              maxLength={projectEstimatePointMaxLength}
              aria-label={`${labels.value} ${index + 1}`}
              placeholder={labels.value}
              onChange={(event) => changePoint(point.id, { value: event.target.value })}
            />
            <Input
              className="w-36 grow"
              dir="auto"
              value={point.description}
              maxLength={projectWorkStructureDescriptionMaxLength}
              aria-label={`${labels.description} ${index + 1}`}
              placeholder={labels.description}
              onChange={(event) => changePoint(point.id, { description: event.target.value })}
            />
            {index > 0 && (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={`${labels.up} ${index + 1}`}
                onClick={() => move(index, -1)}
              >
                <ArrowUp aria-hidden="true" />
              </Button>
            )}
            {index + 1 < draft.points.length && (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={`${labels.down} ${index + 1}`}
                onClick={() => move(index, 1)}
              >
                <ArrowDown aria-hidden="true" />
              </Button>
            )}
            {draft.points.length > projectEstimatePointMinCount && (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={`${labels.remove} ${index + 1}`}
                onClick={() =>
                  setDraft({ ...draft, points: draft.points.filter(({ id }) => id !== point.id) })
                }
              >
                <Trash2 aria-hidden="true" />
              </Button>
            )}
          </div>
        ))}
        {draft.points.length < projectEstimatePointMaxCount && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              setDraft({
                ...draft,
                points: [...draft.points, createPoint("", draft.points.length)],
              })
            }
          >
            {labels.addValue}
          </Button>
        )}
        {removed.map((point) => (
          <label className="flex flex-wrap items-center gap-2 text-sm" key={point.id}>
            <span>
              {labels.replace} <bdi>{point.value}</bdi>
            </span>
            <select
              className="h-9 rounded-md border bg-background px-2"
              aria-label={`${labels.replace} ${point.value}`}
              value={replacements[point.id] ?? ""}
              onChange={(event) =>
                setReplacements({ ...replacements, [point.id]: event.target.value })
              }
            >
              <option value="">{labels.clearEstimate}</option>
              {draft.points.map(({ id, value }) => (
                <option key={id} value={id}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        ))}
      </fieldset>
      {!valid && <p className="text-sm text-muted-foreground">{labels.invalidScale}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={!valid || pending}>
          {pending ? labels.saving : labels.save}
        </Button>
        <Button type="button" variant="outline" disabled={pending} onClick={cancel}>
          {labels.cancel}
        </Button>
      </div>
    </form>
  );
}
