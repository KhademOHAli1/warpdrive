/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Adapted from the cycle, module and view form structure in apps/web/components/{cycles,modules,views}/form.tsx
 * in Plane Community v1.5.0, commit 18caf808a3af3fcabeeba7d1e8473f1367bff2d4.
 */

"use client";

import { useRouter } from "next/navigation";
import {
  type ComponentProps,
  type FormEvent,
  type ReactNode,
  useId,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import { type ProjectFailure, type ProjectWorkspace, projectPriorities } from "../contracts";
import { ProjectWriteNotice } from "../ui/ProjectTitleDialog";
import { projectsTranslator } from "../ui/projectMessages";
import {
  emptyPlanningViewFilters,
  type PlanningGroup,
  type PlanningGroupKind,
  type PlanningSavedView,
  planningModuleStatuses,
  planningViewLayouts,
  savePlanningGroupInput,
  savePlanningViewInput,
  type WorkspacePlanning,
} from "./contracts";
import { type PlanningLabels, planningLabels } from "./messages";
import { planningPath } from "./paths";

const fieldClass = "min-w-0 space-y-1.5 text-sm";
export const planningSelectClass =
  "h-9 w-full rounded-md border bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring";

function PlanningInput({ label, ...props }: ComponentProps<typeof Input> & { label: string }) {
  const id = useId();
  return (
    <label htmlFor={id} className={fieldClass}>
      {label}
      <Input {...props} id={id} />
    </label>
  );
}

function FormFields({
  entry,
  labels,
}: {
  entry: { title: string; description: string } | undefined;
  labels: PlanningLabels;
}) {
  return (
    <>
      <PlanningInput
        label={labels.name}
        name="title"
        maxLength={120}
        defaultValue={entry?.title}
        required
      />
      <label className={fieldClass}>
        {labels.description}
        <textarea
          name="description"
          rows={3}
          maxLength={4000}
          defaultValue={entry?.description}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>
    </>
  );
}

function editorPayload(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  return (field: string) => {
    const value = data.get(field);
    return typeof value === "string" ? value : "";
  };
}

function FormNotice({ error }: { error: ProjectFailure | null }) {
  const { locale, numberingSystem } = useLocalePreferences();
  return <ProjectWriteNotice error={error} labels={projectsTranslator(locale, numberingSystem)} />;
}

function EditorActions({
  pending,
  error,
  labels,
}: {
  pending: boolean;
  error: ProjectFailure | null;
  labels: PlanningLabels;
}) {
  return (
    <div className="space-y-2">
      <Button type="submit" disabled={pending}>
        {labels.save}
      </Button>
      <FormNotice error={error} />
    </div>
  );
}

export function PlanningGroupEditor({
  actorId,
  projectId,
  kind,
  group,
}: {
  actorId: string;
  projectId: string;
  kind: PlanningGroupKind;
  group?: PlanningGroup;
}) {
  const { locale } = useLocalePreferences();
  const labels = planningLabels[locale];
  const router = useRouter();
  const [error, setError] = useState<ProjectFailure | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);
  const draftId = useRef(group?.id ?? null);
  const save = trpc.internalProjects.planning.saveGroup.useMutation();
  const cycle = kind === "cycles";

  async function submit(event: FormEvent<HTMLFormElement>) {
    const read = editorPayload(event);
    draftId.current ??= crypto.randomUUID();
    const startDate = read("startDate") || null;
    const endDate = read("endDate") || null;
    setDateError(null);
    setError(null);
    if (cycle && (startDate === null) !== (endDate === null)) {
      setDateError(labels.datesRequired);
      return;
    }
    if (startDate !== null && endDate !== null && startDate > endDate) {
      setDateError(labels.datesOrder);
      return;
    }
    const parsed = savePlanningGroupInput.safeParse({
      projectId,
      kind,
      groupId: draftId.current,
      expectedActorId: actorId,
      csrfToken: readCsrfToken(),
      title: read("title"),
      description: read("description"),
      revision: group?.revision ?? null,
      startDate,
      endDate,
      moduleStatus: cycle ? null : read("moduleStatus"),
    });
    if (!parsed.success) {
      setError("project_invalid");
      return;
    }
    try {
      const result = await save.mutateAsync(parsed.data);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(planningPath(projectId, kind, result.value.id));
      router.refresh();
    } catch {
      setError("project_unavailable");
    }
  }

  return (
    <form className="grid gap-3 pt-3" onSubmit={(event) => void submit(event)}>
      <FormFields entry={group} labels={labels} />
      <div className="grid gap-3 sm:grid-cols-2">
        <PlanningInput
          label={labels.startDate}
          type="date"
          name="startDate"
          defaultValue={group?.startDate ?? ""}
        />
        <PlanningInput
          label={labels.endDate}
          type="date"
          name="endDate"
          defaultValue={group?.endDate ?? ""}
        />
      </div>
      {cycle ? (
        <p className="text-sm text-muted-foreground">{labels.dates}</p>
      ) : (
        <label className={fieldClass}>
          {labels.moduleStatus}
          <select
            className={planningSelectClass}
            name="moduleStatus"
            defaultValue={group?.moduleStatus ?? "planned"}
          >
            {planningModuleStatuses.map((status) => (
              <option key={status} value={status}>
                {labels[status]}
              </option>
            ))}
          </select>
        </label>
      )}
      {dateError !== null && (
        <p role="alert" className="text-sm text-destructive">
          {dateError}
        </p>
      )}
      <EditorActions pending={save.isPending} error={error} labels={labels} />
    </form>
  );
}

function FilterSelect({
  name,
  label,
  value,
  children,
}: {
  name: string;
  label: string;
  value: string;
  children: ReactNode;
}) {
  return (
    <label className={fieldClass}>
      {label}
      <select name={name} className={planningSelectClass} defaultValue={value}>
        {children}
      </select>
    </label>
  );
}

export function PlanningViewEditor({
  actorId,
  workspace,
  planning,
  view,
}: {
  actorId: string;
  workspace: Pick<ProjectWorkspace, "project" | "states" | "members">;
  planning: Pick<WorkspacePlanning, "cycles" | "modules">;
  view?: PlanningSavedView;
}) {
  const { locale, numberingSystem } = useLocalePreferences();
  const labels = planningLabels[locale];
  const project = projectsTranslator(locale, numberingSystem);
  const router = useRouter();
  const [error, setError] = useState<ProjectFailure | null>(null);
  const draftId = useRef(view?.id ?? null);
  const save = trpc.internalProjects.planning.saveView.useMutation();
  const projectId = workspace.project.id;
  const filters = view?.filters ?? emptyPlanningViewFilters;

  async function submit(event: FormEvent<HTMLFormElement>) {
    const read = editorPayload(event);
    draftId.current ??= crypto.randomUUID();
    setError(null);
    const parsed = savePlanningViewInput.safeParse({
      projectId,
      viewId: draftId.current,
      expectedActorId: actorId,
      csrfToken: readCsrfToken(),
      title: read("title"),
      description: read("description"),
      revision: view?.revision ?? null,
      layout: read("layout"),
      visibility: read("visibility"),
      filters: {
        query: read("query"),
        status: read("status"),
        assignee: read("assignee"),
        priority: read("priority"),
        cycleId: read("cycleId"),
        moduleId: read("moduleId"),
      },
    });
    if (!parsed.success) {
      setError("project_invalid");
      return;
    }
    try {
      const result = await save.mutateAsync(parsed.data);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(planningPath(projectId, "views", result.value.id));
      router.refresh();
    } catch {
      setError("project_unavailable");
    }
  }

  return (
    <form className="grid gap-3 pt-3" onSubmit={(event) => void submit(event)}>
      <FormFields entry={view} labels={labels} />
      <div className="grid gap-3 sm:grid-cols-2">
        <FilterSelect name="layout" label={labels.layout} value={view?.layout ?? "list"}>
          {planningViewLayouts.map((layout) => (
            <option key={layout} value={layout}>
              {labels[layout]}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          name="visibility"
          label={labels.visibility}
          value={view?.visibility ?? "project"}
        >
          <option value="project">{labels.project}</option>
          <option value="private">{labels.private}</option>
        </FilterSelect>
      </div>
      <fieldset className="space-y-3 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">{labels.fields}</legend>
        <PlanningInput
          label={labels.search}
          type="search"
          name="query"
          maxLength={160}
          defaultValue={filters.query}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <FilterSelect name="status" label={labels.status} value={filters.status}>
            <option value="">{labels.all}</option>
            {workspace.states.map(({ id, name }) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
            {filters.status !== "" && !workspace.states.some(({ id }) => id === filters.status) && (
              <option value={filters.status}>{filters.status}</option>
            )}
          </FilterSelect>
          <FilterSelect name="assignee" label={labels.assignee} value={filters.assignee}>
            <option value="">{labels.all}</option>
            <option value="unassigned">{labels.unassigned}</option>
            {[workspace.project.owner, ...workspace.members.map(({ person }) => person)].map(
              ({ id, name }) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ),
            )}
          </FilterSelect>
          <FilterSelect name="priority" label={labels.priority} value={filters.priority}>
            <option value="">{labels.all}</option>
            {projectPriorities.map((priority) => (
              <option key={priority} value={priority}>
                {project(`priority.${priority}`)}
              </option>
            ))}
          </FilterSelect>
          {(
            [
              { options: planning.cycles, name: "cycleId", label: labels.cycle },
              { options: planning.modules, name: "moduleId", label: labels.module },
            ] as const
          ).map(({ options, name, label }) => (
            <FilterSelect key={name} name={name} label={label} value={filters[name]}>
              <option value="">{labels.all}</option>
              {options
                .filter(({ archived, id }) => !archived || id === filters[name])
                .map(({ id, title }) => (
                  <option key={id} value={id}>
                    {title}
                  </option>
                ))}
            </FilterSelect>
          ))}
        </div>
      </fieldset>
      <EditorActions pending={save.isPending} error={error} labels={labels} />
    </form>
  );
}
