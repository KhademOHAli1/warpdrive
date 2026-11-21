"use client";

import { type FormEvent, useDeferredValue, useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import type { ProjectWorkflowState } from "../../contracts";
import { ProjectWriteNotice } from "../../ui/ProjectTitleDialog";
import type { ProjectsTranslator } from "../../ui/projectMessages";
import { useProjectWrites } from "../../ui/projectWrites";
import type { ProjectIntakeFilter, ProjectIntakeRequest } from "../contracts";
import type { ReviewIntakeRequestInput } from "../input";
import type { IntakeMessages } from "../messages";

export type IntakeDecision = ReviewIntakeRequestInput["action"] | "withdraw";
const afterDecision: Record<IntakeDecision, ProjectIntakeFilter> = {
  accept: "accepted",
  decline: "declined",
  snooze: "snoozed",
  unsnooze: "pending",
  duplicate: "duplicate",
  withdraw: "pending",
};

function WorkItemOptions({
  projectId,
  chosen,
  setChosen,
  labels,
}: {
  projectId: string;
  chosen: string;
  setChosen: (id: string) => void;
  labels: IntakeMessages;
}) {
  const [search, setSearch] = useState("");
  const deferred = useDeferredValue(search);
  const { data, isError, isPending } = trpc.internalProjects.intake.workItems.useQuery({
    projectId,
    search: deferred,
  });
  const items = data?.ok === true ? data.value : [];
  const failed = isError || data?.ok === false;
  return (
    <div className="grid gap-2">
      <Input
        aria-label={labels.searchItems}
        placeholder={labels.searchItems}
        maxLength={160}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="max-h-48 overflow-y-auto rounded border">
        {items.map(({ id, title, identifier }) => (
          <button
            key={id}
            type="button"
            aria-pressed={id === chosen}
            className="block w-full border-b px-3 py-2 text-start text-sm last:border-b-0 hover:bg-muted aria-pressed:bg-accent"
            onClick={() => setChosen(id)}
          >
            <span className="me-2 text-muted-foreground">{identifier}</span>
            <bdi>{title}</bdi>
          </button>
        ))}
        {isPending && (
          <p role="status" className="p-2 text-sm text-muted-foreground">
            {labels.loading}
          </p>
        )}
        {!isPending && items.length === 0 && (
          <p className="p-2 text-sm text-muted-foreground">
            {failed ? labels.loadFailed : labels.noItems}
          </p>
        )}
      </div>
    </div>
  );
}

export function IntakeDecisionDialog({
  action,
  labels,
  projects,
  actorId,
  projectId,
  states,
  request,
  close,
  onSaved,
}: {
  action: IntakeDecision;
  labels: IntakeMessages;
  projects: ProjectsTranslator;
  actorId: string;
  projectId: string;
  states: ProjectWorkflowState[];
  request: ProjectIntakeRequest;
  close: () => void;
  onSaved: (filter: ProjectIntakeFilter, requestId?: string) => void;
}) {
  const review = trpc.internalProjects.intake.review.useMutation({ gcTime: 0 });
  const withdraw = trpc.internalProjects.intake.withdraw.useMutation({ gcTime: 0 });
  const { pending, execute, error } = useProjectWrites();
  const [stateId, setStateId] = useState("");
  const [snoozeDate, setSnoozeDate] = useState("");
  const [workItemId, setWorkItemId] = useState("");
  const dateId = useId();
  const prompts = {
    accept: [labels.accept, labels.acceptDescription],
    decline: [labels.decline, labels.declineDescription],
    snooze: [labels.snooze, labels.snoozeDescription],
    unsnooze: [labels.unsnooze, labels.unsnooze],
    duplicate: [labels.markDuplicate, labels.duplicateDescription],
    withdraw: [labels.withdraw, labels.withdrawDescription],
  } as const;
  const [title, description] = prompts[action];
  const invalid =
    (action === "duplicate" && workItemId === "") || (action === "snooze" && snoozeDate === "");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || invalid) return;
    const target = {
      projectId,
      requestId: request.id,
      revision: request.revision,
      expectedActorId: actorId,
      csrfToken: readCsrfToken(),
    };
    if (action === "withdraw") {
      void execute(
        () => withdraw.mutateAsync(target),
        () => onSaved("pending"),
      );
      return;
    }
    const payload = decisionPayload({ action, stateId, snoozeDate, workItemId });
    if (payload === null) return;
    void execute(
      () => review.mutateAsync({ ...target, ...payload }),
      ({ id }) => onSaved(afterDecision[action], id),
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) close();
      }}
    >
      <DialogContent className={BLOCK_CLASS}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <ProjectWriteNotice error={error} labels={projects} />
          {action === "accept" && (
            <Select
              value={stateId}
              onChange={setStateId}
              ariaLabel={labels.state}
              disabled={pending}
              options={[
                { value: "", label: labels.defaultState },
                ...states.map(({ id, name }) => ({ value: id, label: name })),
              ]}
            />
          )}
          {action === "snooze" && (
            <div className="grid gap-1.5">
              <label className="text-sm font-medium" htmlFor={dateId}>
                {labels.snoozeUntil}
              </label>
              <Input
                id={dateId}
                type="date"
                required
                value={snoozeDate}
                disabled={pending}
                onChange={(event) => setSnoozeDate(event.target.value)}
              />
            </div>
          )}
          {action === "duplicate" && (
            <WorkItemOptions
              projectId={projectId}
              chosen={workItemId}
              setChosen={setWorkItemId}
              labels={labels}
            />
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close} disabled={pending}>
              {labels.cancel}
            </Button>
            <Button
              type="submit"
              disabled={pending || invalid}
              variant={action === "decline" || action === "withdraw" ? "destructive" : "default"}
            >
              {pending ? labels.working : title}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function decisionPayload({
  action,
  stateId,
  snoozeDate,
  workItemId,
}: {
  action: Exclude<IntakeDecision, "withdraw">;
  stateId: string;
  snoozeDate: string;
  workItemId: string;
}) {
  switch (action) {
    case "accept":
      return { action, stateId: stateId === "" ? undefined : stateId };
    case "duplicate":
      return { action, workItemId };
    case "snooze": {
      const date = new Date(`${snoozeDate}T00:00:00`);
      return Number.isFinite(date.getTime()) ? { action, until: date.toISOString() } : null;
    }
    case "decline":
    case "unsnooze":
      return { action };
  }
}
