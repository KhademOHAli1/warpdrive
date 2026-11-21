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
import {
  type ProjectFailure,
  type ProjectWorkspace,
  projectPriorities,
  projectStatuses,
} from "../contracts";
import { ProjectWriteNotice } from "../ui/ProjectTitleDialog";
import { projectsTranslator } from "../ui/projectMessages";
import { planningAdvancedLabels } from "./advancedMessages";
import {
  defaultPlanningViewDisplay,
  emptyPlanningViewFilters,
  type PlanningGroup,
  type PlanningGroupKind,
  type PlanningSavedView,
  type PlanningViewDisplay,
  type PlanningViewLayout,
  planningGroupByOptions,
  planningItemScopes,
  planningModuleStatuses,
  planningOrderByOptions,
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
        <FilterSelect
          name="moduleStatus"
          label={labels.moduleStatus}
          value={group?.moduleStatus ?? "planned"}
        >
          {planningModuleStatuses.map((status) => (
            <option key={status} value={status}>
              {labels[status]}
            </option>
          ))}
        </FilterSelect>
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
  change,
}: {
  name: string;
  label: string;
  value: string;
  children: ReactNode;
  change?: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className={fieldClass}>
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        name={name}
        className={planningSelectClass}
        defaultValue={value}
        onChange={change === undefined ? undefined : (event) => change(event.target.value)}
      >
        {children}
      </select>
    </div>
  );
}

const propertyFields = [
  "showKey",
  "showStatus",
  "showAssignee",
  "showPriority",
  "showStartDate",
  "showDueDate",
  "showLabels",
  "showEstimate",
] as const;

function displayCapabilities(layout: PlanningViewLayout) {
  return {
    group: layout === "list" || layout === "board",
    sort: layout !== "calendar",
    properties:
      layout === "calendar" || layout === "gantt_chart" ? (["showKey"] as const) : propertyFields,
  };
}

function ViewDisplayFields({
  layout,
  display,
}: {
  layout: PlanningViewLayout;
  display: PlanningViewDisplay;
}) {
  const { locale } = useLocalePreferences();
  const labels = planningAdvancedLabels[locale];
  const base = planningLabels[locale];
  const capabilities = displayCapabilities(layout);
  const [groupBy, setGroupBy] = useState(
    layout === "board" && display.groupBy === "none" ? "state" : display.groupBy,
  );
  const groupLabels = {
    state: labels.state,
    priority: labels.priority,
    none: labels.none,
    assignee: base.assignee,
    creator: labels.createdBy,
    label: labels.label,
    cycle: base.cycle,
    module: base.module,
  };
  const scopeLabels = {
    all: labels.allItems,
    active: labels.activeItems,
    backlog: labels.backlogItems,
  };
  return (
    <fieldset className="space-y-3 rounded-md border p-3">
      <legend className="px-1 text-sm font-medium">{labels.display}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {capabilities.group && (
          <FilterSelect
            name="groupBy"
            label={labels.groupBy}
            value={groupBy}
            change={(value) => {
              const choice = planningGroupByOptions.find((candidate) => candidate === value);
              if (choice !== undefined) setGroupBy(choice);
            }}
          >
            {planningGroupByOptions
              .filter((value) => layout !== "board" || value !== "none")
              .map((value) => (
                <option key={value} value={value}>
                  {groupLabels[value]}
                </option>
              ))}
          </FilterSelect>
        )}
        {layout === "board" && (
          <FilterSelect
            key={groupBy}
            name="subGroupBy"
            label={labels.subGroupBy}
            value={display.subGroupBy === groupBy ? "none" : display.subGroupBy}
          >
            {planningGroupByOptions
              .filter((value) => value !== groupBy)
              .map((value) => (
                <option key={value} value={value}>
                  {groupLabels[value]}
                </option>
              ))}
          </FilterSelect>
        )}
        {capabilities.sort && (
          <FilterSelect name="orderBy" label={labels.orderBy} value={display.orderBy}>
            {planningOrderByOptions.map((value) => (
              <option key={value} value={value}>
                {labels[value]}
              </option>
            ))}
          </FilterSelect>
        )}
        <FilterSelect name="itemScope" label={labels.itemScope} value={display.itemScope}>
          {planningItemScopes.map((value) => (
            <option key={value} value={value}>
              {scopeLabels[value]}
            </option>
          ))}
        </FilterSelect>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {capabilities.group && groupBy !== "none" && (
          <label className="inline-flex items-center gap-2">
            <input
              name="showEmptyGroups"
              type="checkbox"
              defaultChecked={display.showEmptyGroups}
            />
            {labels.showEmptyGroups}
          </label>
        )}
        {capabilities.properties.map((name) => (
          <label className="inline-flex items-center gap-2" key={name}>
            <input name={name} type="checkbox" defaultChecked={display[name]} />
            {labels[name]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function readViewDisplay(
  read: ReturnType<typeof editorPayload>,
  layout: PlanningViewLayout,
  previous: PlanningViewDisplay,
) {
  const capabilities = displayCapabilities(layout);
  const groupBy = capabilities.group ? read("groupBy") : previous.groupBy;
  return {
    groupBy,
    subGroupBy: layout === "board" ? read("subGroupBy") : "none",
    itemScope: read("itemScope"),
    orderBy: capabilities.sort ? read("orderBy") : previous.orderBy,
    showEmptyGroups:
      capabilities.group && groupBy !== "none"
        ? read("showEmptyGroups") === "on"
        : previous.showEmptyGroups,
    ...Object.fromEntries(
      propertyFields.map((name) => [
        name,
        capabilities.properties.some((property) => property === name)
          ? read(name) === "on"
          : previous[name],
      ]),
    ),
  };
}

export function PlanningViewEditor({
  actorId,
  workspace,
  planning,
  view,
}: {
  actorId: string;
  workspace: Pick<ProjectWorkspace, "project" | "states" | "members" | "workStructure">;
  planning: Pick<WorkspacePlanning, "cycles" | "modules">;
  view?: PlanningSavedView;
}) {
  const { locale, numberingSystem } = useLocalePreferences();
  const labels = planningLabels[locale];
  const advanced = planningAdvancedLabels[locale];
  const project = projectsTranslator(locale, numberingSystem);
  const router = useRouter();
  const [error, setError] = useState<ProjectFailure | null>(null);
  const [selectedLayout, setSelectedLayout] = useState<PlanningViewLayout>(view?.layout ?? "list");
  const draftId = useRef(view?.id ?? null);
  const save = trpc.internalProjects.planning.saveView.useMutation();
  const projectId = workspace.project.id;
  const filters = view?.filters ?? emptyPlanningViewFilters;
  const display = view?.display ?? defaultPlanningViewDisplay;
  const people = [workspace.project.owner, ...workspace.members.map(({ person }) => person)];
  const itemLabels = workspace.workStructure.labels.filter(({ kind }) => kind === "label");
  const estimatePoints =
    workspace.workStructure.scales.find(({ id }) => id === workspace.workStructure.activeScaleId)
      ?.points ?? [];
  const dateFields = ["startFrom", "startTo", "dueFrom", "dueTo"] as const;
  const legacyStatus = projectStatuses.find((status) => status === filters.status);

  function missingOption(values: { id: string }[], value: string | undefined) {
    return value !== undefined &&
      value !== "" &&
      value !== "unassigned" &&
      !values.some(({ id }) => id === value) ? (
      <option value={value}>{advanced.unavailableOption}</option>
    ) : null;
  }

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
      display: readViewDisplay(read, selectedLayout, display),
      filters: {
        query: read("query"),
        status: read("status"),
        assignee: read("assignee"),
        priority: read("priority"),
        cycleId: read("cycleId"),
        moduleId: read("moduleId"),
        createdBy: read("createdBy"),
        labelId: read("labelId"),
        estimatePointId: read("estimatePointId"),
        ...Object.fromEntries(dateFields.map((field) => [field, read(field)])),
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
        <FilterSelect
          name="layout"
          label={labels.layout}
          value={view?.layout ?? "list"}
          change={(next) => {
            const layout = planningViewLayouts.find((value) => value === next);
            if (layout !== undefined) setSelectedLayout(layout);
          }}
        >
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
      <ViewDisplayFields key={selectedLayout} layout={selectedLayout} display={display} />
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
              <option value={filters.status}>
                {legacyStatus === undefined
                  ? advanced.unavailableOption
                  : project(`status.${legacyStatus}`)}
              </option>
            )}
          </FilterSelect>
          <FilterSelect name="assignee" label={labels.assignee} value={filters.assignee}>
            <option value="">{labels.all}</option>
            <option value="unassigned">{labels.unassigned}</option>
            {people.map(({ id, name }) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
            {missingOption(people, filters.assignee)}
          </FilterSelect>
          <FilterSelect name="createdBy" label={advanced.createdBy} value={filters.createdBy ?? ""}>
            <option value="">{labels.all}</option>
            {people.map(({ id, name }) => (
              <option value={id} key={id}>
                {name}
              </option>
            ))}
            {missingOption(people, filters.createdBy)}
          </FilterSelect>
          <FilterSelect name="labelId" label={advanced.label} value={filters.labelId ?? ""}>
            <option value="">{labels.all}</option>
            {itemLabels.map(({ id, name }) => (
              <option value={id} key={id}>
                {name}
              </option>
            ))}
            {missingOption(itemLabels, filters.labelId)}
          </FilterSelect>
          <FilterSelect
            name="estimatePointId"
            label={advanced.estimate}
            value={filters.estimatePointId ?? ""}
          >
            <option value="">{labels.all}</option>
            {estimatePoints.map(({ id, value }) => (
              <option value={id} key={id}>
                {value}
              </option>
            ))}
            {missingOption(estimatePoints, filters.estimatePointId)}
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
          {dateFields.map((field) => (
            <PlanningInput
              key={field}
              label={advanced[field]}
              name={field}
              type="date"
              defaultValue={filters[field] ?? ""}
            />
          ))}
        </div>
      </fieldset>
      <EditorActions pending={save.isPending} error={error} labels={labels} />
    </form>
  );
}
