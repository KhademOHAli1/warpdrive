"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import {
  type ProjectItem,
  type ProjectResult,
  type ProjectWorkspace,
  projectItemKey,
} from "../contracts";
import { ProjectItemStructureBadges } from "./ProjectItemStructure";
import { ProjectItemSubscription } from "./ProjectItemSubscription";
import { draftForProjectWorkItem, ProjectWorkItemForm } from "./ProjectWorkItemForm";
import type { ProjectItemChanges } from "./ProjectWorkItems";
import type { ProjectsTranslator } from "./projectMessages";
import { workflowStateLabel } from "./projectWorkflowUi";
import { useProjectFormatters } from "./useProjectFormatters";

export function ProjectWorkItemPeek({
  item,
  workspace,
  labels,
  pending,
  updateItem,
  close,
  restoreFocus,
  planning,
  lifecycle,
}: {
  item: ProjectItem;
  workspace: ProjectWorkspace;
  labels: ProjectsTranslator;
  pending: boolean;
  updateItem: (
    item: ProjectItem,
    changes: ProjectItemChanges,
    report?: boolean,
  ) => Promise<ProjectResult<ProjectWorkspace>>;
  close: () => void;
  restoreFocus: () => boolean;
  planning?: ReactNode;
  lifecycle?: ReactNode;
}) {
  const format = useProjectFormatters();
  const state = workspace.states.find(({ id }) => id === item.stateId);
  const assignees = [workspace.project.owner, ...workspace.members.map(({ person }) => person)];
  const assignee = assignees.find(({ id }) => id === item.assigneeId);
  return (
    <Sheet
      open
      onOpenChange={(isOpen) => {
        if (!isOpen && !pending) close();
      }}
    >
      <SheetContent
        aria-describedby={undefined}
        className={`max-w-2xl p-5 sm:p-7 ${BLOCK_CLASS} ph-no-capture`}
        onCloseAutoFocus={(event) => {
          if (restoreFocus()) event.preventDefault();
        }}
      >
        <header className="mb-5 flex flex-wrap items-start gap-3 border-b pe-8 pb-4 sm:justify-between">
          <div className="min-w-0">
            <p className="mb-1 truncate text-sm text-muted-foreground">
              <bdi>{workspace.project.title}</bdi>
              <span className="mx-2" aria-hidden="true">
                ·
              </span>
              <bdi dir="ltr">
                {projectItemKey(workspace.project.identifier, item.sequenceNumber)}
              </bdi>
            </p>
            <SheetTitle className="wrap-anywhere text-xl">
              <bdi>{item.title}</bdi>
            </SheetTitle>
          </div>
          {!workspace.project.archived && item.archivedAt === null && (
            <ProjectItemSubscription
              projectId={workspace.project.id}
              itemId={item.id}
              labels={labels}
            />
          )}
          {lifecycle}
        </header>
        {workspace.canEdit ? (
          <ProjectWorkItemForm
            key={`${item.id}:${item.revision}`}
            initial={draftForProjectWorkItem(item)}
            pending={pending}
            labels={labels}
            workspace={workspace}
            requireChange
            submit={async (draft) => {
              const { assigneeId, ...properties } = draft;
              const changes =
                workspace.canAssign && assigneeId !== item.assigneeId
                  ? { ...properties, assigneeId }
                  : properties;
              const result = await updateItem(item, changes, false);
              return result.ok ? null : result.error;
            }}
          />
        ) : (
          <div className="space-y-5">
            {item.description && (
              <p className="wrap-anywhere whitespace-pre-wrap text-sm leading-relaxed">
                <bdi>{item.description}</bdi>
              </p>
            )}
            <ProjectItemStructureBadges
              item={item}
              catalog={workspace.workStructure}
              labels={labels}
            />
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 text-sm">
              <dt className="text-muted-foreground">{labels("workspace.statusColumn")}</dt>
              <dd>
                <Badge variant="secondary">
                  {state === undefined
                    ? labels(`status.${item.status}`)
                    : workflowStateLabel(state, labels)}
                </Badge>
              </dd>
              <dt className="text-muted-foreground">{labels("workspace.priority")}</dt>
              <dd>{labels(`priority.${item.priority}`)}</dd>
              <dt className="text-muted-foreground">{labels("workspace.assigneeColumn")}</dt>
              <dd>
                <bdi>{assignee?.name ?? labels("workspace.unassigned")}</bdi>
              </dd>
              {item.startDate !== null && (
                <>
                  <dt className="text-muted-foreground">{labels("workspace.startDate")}</dt>
                  <dd>{format.dateOnly(item.startDate)}</dd>
                </>
              )}
              {item.dueDate !== null && (
                <>
                  <dt className="text-muted-foreground">{labels("workspace.dueDate")}</dt>
                  <dd>{format.dateOnly(item.dueDate)}</dd>
                </>
              )}
            </dl>
          </div>
        )}
        {planning}
      </SheetContent>
    </Sheet>
  );
}
