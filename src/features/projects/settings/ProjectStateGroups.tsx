/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Adapted from Plane Community v1.5.0, apps/web/components/project-states/{group-list,group-item}.tsx.
 */

import { ArrowDown, ArrowUp, ChevronDown, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils";
import {
  type ProjectStateCategory,
  type ProjectWorkflowState,
  type ProjectWorkspace,
  projectStateCategories,
  projectStateLegacyStatus,
  projectStateNameMaxLength,
  projectStatesMaxCount,
  projectStatuses,
} from "../contracts";
import type { ProjectSettingsMessages } from "./messages";

function withPositions(states: ProjectWorkflowState[]) {
  return projectStateCategories.flatMap((category) =>
    states
      .filter((state) => state.category === category)
      .map((state, position) => ({ ...state, position })),
  );
}

function supportsLegacyStatuses(states: ProjectWorkflowState[]) {
  return (
    new Set(states.map((state) => projectStateLegacyStatus(state.category))).size ===
    projectStatuses.length
  );
}

export function ProjectStateGroups({
  initial,
  labels,
  pending,
  save,
}: {
  initial: ProjectWorkspace;
  labels: ProjectSettingsMessages;
  pending: boolean;
  save: (states: ProjectWorkflowState[]) => void;
}) {
  const defaultField = useId();
  const [states, setStates] = useState(initial.states);
  const [groupsExpanded, setGroupsExpanded] = useState<ProjectStateCategory[]>([
    ...projectStateCategories,
  ]);
  const names = states.map((state) => state.name.trim().toLowerCase());
  const valid =
    names.every(Boolean) && new Set(names).size === names.length && supportsLegacyStatuses(states);
  const changed = JSON.stringify(states) !== JSON.stringify(initial.states);
  const used = new Set(initial.items.map((item) => item.stateId));

  function toggleGroup(category: ProjectStateCategory) {
    setGroupsExpanded((current) =>
      current.includes(category)
        ? current.filter((part) => part !== category)
        : [...current, category],
    );
  }

  function addState(category: ProjectStateCategory) {
    setGroupsExpanded((current) => (current.includes(category) ? current : [...current, category]));
    const id = crypto.randomUUID();
    setStates((current) =>
      withPositions([
        ...current,
        { id, name: "", category, position: 0, color: "#60646c", isDefault: false },
      ]),
    );
  }

  function editState(state: ProjectWorkflowState, changes: Partial<ProjectWorkflowState>) {
    setStates((current) =>
      withPositions(
        current.map((entry) => (entry.id === state.id ? { ...entry, ...changes } : entry)),
      ),
    );
  }

  function setDefault(id: string) {
    setStates((current) => current.map((state) => ({ ...state, isDefault: state.id === id })));
  }

  function moveState(state: ProjectWorkflowState, neighbour: ProjectWorkflowState) {
    setStates((current) =>
      withPositions(
        current.map((entry) => {
          if (entry.id === state.id) return neighbour;
          return entry.id === neighbour.id ? state : entry;
        }),
      ),
    );
  }

  function removeState(id: string) {
    setStates((current) => {
      const next = withPositions(current.filter((state) => state.id !== id));
      return next.some((state) => state.isDefault)
        ? next
        : next.map((state, index) => ({ ...state, isDefault: index === 0 }));
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (valid && changed && !pending)
      save(states.map((state) => ({ ...state, name: state.name.trim() })));
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {labels.defaultsHelp} {labels.compatibilityHelp}
      </p>
      {projectStateCategories.map((category) => {
        const expanded = groupsExpanded.includes(category);
        const groupStates = states.filter((state) => state.category === category);
        const panelId = `${defaultField}-${category}`;
        return (
          <section key={category} className="rounded-lg border bg-card">
            <div className="flex items-center justify-between gap-3 px-3 py-2">
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={panelId}
                onClick={() => toggleGroup(category)}
                className="flex min-w-0 items-center gap-2 rounded px-1 py-1 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronDown
                  aria-hidden="true"
                  className={cn("size-4", !expanded && "-rotate-90 rtl:rotate-90")}
                />
                {labels[category]}
              </button>
              {states.length < projectStatesMaxCount && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`${labels.add} · ${labels[category]}`}
                  disabled={pending}
                  onClick={() => addState(category)}
                >
                  <Plus aria-hidden="true" /> {labels.add}
                </Button>
              )}
            </div>
            <div id={panelId} hidden={!expanded}>
              {groupStates.map((state, index) => {
                const previous = groupStates[index - 1];
                const next = groupStates[index + 1];
                const stateUsed = used.has(state.id);
                const mayRemove =
                  !stateUsed &&
                  supportsLegacyStatuses(states.filter((entry) => entry.id !== state.id));
                const name = state.name || labels.stateNamePlaceholder;
                return (
                  <div
                    key={state.id}
                    className="flex flex-wrap items-center gap-2 border-t px-3 py-2"
                  >
                    <Input
                      type="color"
                      value={state.color}
                      aria-label={`${labels.stateColor} · ${name}`}
                      className="size-9 shrink-0 cursor-pointer p-1"
                      disabled={pending}
                      onChange={(event) => editState(state, { color: event.target.value })}
                    />
                    <Input
                      value={state.name}
                      placeholder={labels.stateNamePlaceholder}
                      maxLength={projectStateNameMaxLength}
                      aria-label={`${labels.stateName} · ${name}`}
                      className="w-40 flex-1"
                      disabled={pending}
                      onChange={(event) => editState(state, { name: event.target.value })}
                    />
                    <select
                      aria-label={`${labels.stateCategory} · ${name}`}
                      className="h-9 rounded-md border bg-background px-2 text-sm"
                      value={state.category}
                      disabled={pending}
                      onChange={(event) => {
                        const candidate = projectStateCategories.find(
                          (part) => part === event.target.value,
                        );
                        if (candidate !== undefined) editState(state, { category: candidate });
                      }}
                    >
                      {projectStateCategories.map((part) => (
                        <option key={part} value={part}>
                          {labels[part]}
                        </option>
                      ))}
                    </select>
                    <label className="inline-flex items-center gap-2 px-2 text-sm">
                      <input
                        type="radio"
                        name={defaultField}
                        checked={state.isDefault}
                        disabled={pending}
                        onChange={() => setDefault(state.id)}
                        aria-label={`${labels.defaultState} · ${name}`}
                      />
                      {labels.defaultState}
                    </label>
                    {previous !== undefined && (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={`${labels.moveUp} · ${name}`}
                        disabled={pending}
                        onClick={() => moveState(state, previous)}
                      >
                        <ArrowUp aria-hidden="true" />
                      </Button>
                    )}
                    {next !== undefined && (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={`${labels.moveDown} · ${name}`}
                        disabled={pending}
                        onClick={() => moveState(state, next)}
                      >
                        <ArrowDown aria-hidden="true" />
                      </Button>
                    )}
                    {mayRemove && (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={`${labels.remove} · ${name}`}
                        disabled={pending}
                        onClick={() => removeState(state.id)}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    )}
                    {stateUsed && (
                      <p className="w-full text-xs text-muted-foreground">{labels.usedState}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
      {changed && !valid && (
        <p role="alert" className="text-sm text-destructive">
          {labels.invalidStates}
        </p>
      )}
      <Button type="submit" disabled={!changed || !valid || pending}>
        {pending ? labels.saving : labels.save}
      </Button>
    </form>
  );
}
