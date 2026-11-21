"use client";

import { type FormEvent, type ReactNode, useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import {
  type ProjectItem,
  type ProjectWorkspace,
  projectItemDescriptionMaxLength,
  projectItemTitleMaxLength,
  projectPriorities,
  projectStatuses,
} from "../contracts";
import { ProjectWriteNotice } from "./ProjectTitleDialog";
import type { ProjectsTranslator } from "./projectMessages";
import type { ProjectWriteError } from "./projectWrites";

export type ProjectWorkItemDraft = Pick<
  ProjectItem,
  "title" | "description" | "status" | "priority" | "startDate" | "dueDate" | "assigneeId"
>;

export function draftForProjectWorkItem(item: ProjectItem): ProjectWorkItemDraft {
  const { title, description, status, priority, startDate, dueDate, assigneeId } = item;
  return { title, description, status, priority, startDate, dueDate, assigneeId };
}

export function ProjectWorkItemForm({
  initial,
  labels,
  workspace,
  pending,
  cancel,
  requireChange = false,
  submit,
}: {
  initial: ProjectWorkItemDraft;
  labels: ProjectsTranslator;
  workspace: ProjectWorkspace;
  pending: boolean;
  cancel?: () => void;
  requireChange?: boolean;
  submit: (draft: ProjectWorkItemDraft) => Promise<ProjectWriteError | null>;
}) {
  const fields = useId();
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<ProjectWriteError | null>(null);
  const datesValid =
    draft.startDate === null || draft.dueDate === null || draft.startDate <= draft.dueDate;
  const changed = (Object.keys(draft) as (keyof ProjectWorkItemDraft)[]).some(
    (key) => draft[key] !== initial[key],
  );
  const disabled =
    pending || !datesValid || draft.title.trim() === "" || (requireChange && !changed);
  const privacy = `${BLOCK_CLASS} ph-no-capture`;
  const historicalAssignee =
    draft.assigneeId !== null && !workspace.assignees.some(({ id }) => id === draft.assigneeId)
      ? [workspace.project.owner, ...workspace.members.map(({ person }) => person)].find(
          ({ id }) => id === draft.assigneeId,
        )
      : undefined;

  function set<K extends keyof ProjectWorkItemDraft>(key: K, value: ProjectWorkItemDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setError(null);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    const result = await submit({ ...draft, title: draft.title.trim() });
    setError(result);
  }

  return (
    <form onSubmit={(event) => void save(event)} className="space-y-4">
      <fieldset disabled={pending} className="min-w-0 space-y-4">
        <legend className="sr-only">{labels("workspace.properties")}</legend>
        <label htmlFor={`${fields}-title`} className="grid gap-1.5 text-sm">
          <span className="font-medium">{labels("workspace.itemTitle")}</span>
          <Input
            id={`${fields}-title`}
            dir="auto"
            value={draft.title}
            maxLength={projectItemTitleMaxLength}
            required
            onChange={(event) => set("title", event.target.value)}
          />
        </label>
        <label htmlFor={`${fields}-description`} className="grid gap-1.5 text-sm">
          <span className="font-medium">{labels("workspace.description")}</span>
          <Textarea
            id={`${fields}-description`}
            dir="auto"
            value={draft.description}
            maxLength={projectItemDescriptionMaxLength}
            rows={4}
            onChange={(event) => set("description", event.target.value)}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={labels("workspace.statusColumn")}>
            <Select
              ariaLabel={labels("workspace.statusColumn")}
              value={draft.status}
              options={projectStatuses.map((status) => ({
                value: status,
                label: labels(`status.${status}`),
              }))}
              onChange={(value) => {
                const status = projectStatuses.find((choice) => choice === value);
                if (status !== undefined) set("status", status);
              }}
            />
          </Field>
          <Field label={labels("workspace.priority")}>
            <Select
              ariaLabel={labels("workspace.priority")}
              value={draft.priority}
              options={projectPriorities.map((priority) => ({
                value: priority,
                label: labels(`priority.${priority}`),
              }))}
              onChange={(value) => {
                const priority = projectPriorities.find((choice) => choice === value);
                if (priority !== undefined) set("priority", priority);
              }}
            />
          </Field>
          {workspace.canAssign && (
            <Field label={labels("workspace.assigneeColumn")}>
              <Select
                ariaLabel={labels("workspace.assigneeColumn")}
                value={draft.assigneeId ?? ""}
                contentClassName={privacy}
                triggerContent={
                  historicalAssignee === undefined ? undefined : (
                    <bdi>{historicalAssignee.name}</bdi>
                  )
                }
                options={[
                  { value: "", label: labels("workspace.unassigned") },
                  ...workspace.assignees.map(({ id, name }) => ({ value: id, label: name })),
                ]}
                onChange={(value) => set("assigneeId", value === "" ? null : value)}
              />
            </Field>
          )}
          <label htmlFor={`${fields}-start`} className="grid gap-1.5 text-sm">
            <span className="font-medium">{labels("workspace.startDate")}</span>
            <Input
              id={`${fields}-start`}
              type="date"
              value={draft.startDate ?? ""}
              onChange={(event) => set("startDate", event.target.value || null)}
            />
          </label>
          <label htmlFor={`${fields}-due`} className="grid gap-1.5 text-sm">
            <span className="font-medium">{labels("workspace.dueDate")}</span>
            <Input
              id={`${fields}-due`}
              type="date"
              value={draft.dueDate ?? ""}
              onChange={(event) => set("dueDate", event.target.value || null)}
            />
          </label>
        </div>
      </fieldset>
      {!datesValid && (
        <p role="alert" className="text-sm text-destructive">
          {labels("workspace.invalidDates")}
        </p>
      )}
      <ProjectWriteNotice error={error} labels={labels} />
      <div className="flex flex-wrap justify-end gap-2">
        {cancel !== undefined && (
          <Button variant="outline" disabled={pending} onClick={cancel}>
            {labels("actions.cancel")}
          </Button>
        )}
        <Button type="submit" disabled={disabled}>
          {labels(pending ? "actions.saving" : "actions.save")}
        </Button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </div>
  );
}
