"use client";

import { useRef, useState } from "react";
import { PageHeading } from "@/components/shell/PageHeading";
import { EmptyState } from "@/components/ui/EmptyState";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { err } from "@/types/result";
import { type ProjectItem, type ProjectWorkspace, projectItemKey } from "../contracts";
import { ProjectWorkItemPeek } from "../ui/ProjectWorkItemPeek";
import { ProjectWorkspaceNav } from "../ui/ProjectWorkspaceNav";
import { projectsTranslator } from "../ui/projectMessages";
import { useProjectFormatters } from "../ui/useProjectFormatters";
import { projectAutomationMessages } from "./messages";
import { ProjectItemArchiveControl } from "./ProjectItemArchiveControl";

export function ProjectArchiveClient({
  actorId,
  workspace,
  archived,
  initialItemId,
}: {
  actorId: string;
  workspace: ProjectWorkspace;
  archived: ProjectItem[];
  initialItemId?: string;
}) {
  const { locale, numberingSystem } = useLocalePreferences();
  const labels = projectAutomationMessages[locale];
  const work = projectsTranslator(locale, numberingSystem);
  const format = useProjectFormatters();
  const [items, setItems] = useState(archived);
  const [itemId, setItemId] = useState(initialItemId);
  const [restored, setRestored] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const item = items.find(({ id }) => id === itemId);
  const project = workspace.project;

  function close() {
    setItemId(undefined);
    if (new URL(window.location.href).searchParams.has("item")) {
      window.history.replaceState(null, "", `/projects/internal/${project.id}/archive`);
    }
  }

  return (
    <section className={`${BLOCK_CLASS} ph-no-capture`}>
      <PageHeading
        title={labels.itemArchive}
        crumbs={[
          { label: project.title, href: `/projects/internal/${project.id}` },
          { label: labels.itemArchive },
        ]}
      />
      <ProjectWorkspaceNav
        projectId={project.id}
        active="archive"
        canManageSettings={workspace.canManageSettings}
        intakeEnabled={workspace.settings.intakeEnabled}
        restrictedGuest={workspace.guestAccess === "restricted"}
      />
      {restored && (
        <p role="status" className="mb-3 text-sm text-muted-foreground">
          {labels.itemRestored}
        </p>
      )}
      {items.length === 0 ? (
        <EmptyState
          className="rounded-lg border bg-card"
          title={labels.archiveEmpty}
          body={labels.archiveEmptyHelp}
        />
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {items.map((candidate) => (
            <li
              key={candidate.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <button
                type="button"
                className="min-w-0 text-start text-sm font-medium hover:text-primary"
                onClick={(event) => {
                  trigger.current = event.currentTarget;
                  setItemId(candidate.id);
                }}
              >
                <bdi dir="ltr" className="me-2 text-xs text-muted-foreground">
                  {projectItemKey(project.identifier, candidate.sequenceNumber)}
                </bdi>
                <bdi>{candidate.title}</bdi>
              </button>
              {candidate.archivedAt !== null && (
                <time dateTime={candidate.archivedAt} className="text-xs text-muted-foreground">
                  {format.dateTime(candidate.archivedAt)}
                </time>
              )}
            </li>
          ))}
        </ul>
      )}
      {item !== undefined && (
        <ProjectWorkItemPeek
          item={item}
          workspace={{ ...workspace, canEdit: false }}
          labels={work}
          pending={false}
          updateItem={() => Promise.resolve(err("project_forbidden" as const))}
          close={close}
          restoreFocus={() => {
            if (trigger.current?.isConnected !== true) return false;
            trigger.current.focus();
            return true;
          }}
          lifecycle={
            workspace.canEdit ? (
              <ProjectItemArchiveControl
                actorId={actorId}
                projectId={project.id}
                item={item}
                onChanged={() => {
                  setItems((current) => current.filter(({ id }) => id !== item.id));
                  setRestored(true);
                  close();
                }}
              />
            ) : undefined
          }
        />
      )}
    </section>
  );
}
