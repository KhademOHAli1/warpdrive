"use client";

import { FolderKanban, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { PageHeading } from "@/components/shell/PageHeading";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { type ProjectCommands, type ProjectIndex, projectTitleMaxLength } from "../contracts";
import { ProjectTitleDialog } from "./ProjectTitleDialog";
import { projectsTranslator } from "./projectMessages";
import { useProjectWrites } from "./projectWrites";

export function InternalProjectsList({
  initial,
  commands,
  locale,
}: {
  initial: ProjectIndex;
  commands: ProjectCommands;
  locale: Locale;
}) {
  const { numberingSystem } = useLocalePreferences();
  const labels = projectsTranslator(locale, numberingSystem);
  const [projects, setProjects] = useState(initial.projects);
  const { execute, pending } = useProjectWrites();

  return (
    <section className={`${BLOCK_CLASS} ph-no-capture`}>
      <PageHeading
        title={labels("index.title")}
        description={labels("index.description")}
        actions={
          initial.canCreate && (
            <ProjectTitleDialog
              labels={labels}
              title={labels("index.create")}
              description={labels("index.formDescription")}
              field={labels("index.name")}
              maxLength={projectTitleMaxLength}
              pending={pending}
              trigger={
                <Button>
                  <Plus aria-hidden="true" className="size-4" />
                  {labels("index.create")}
                </Button>
              }
              submit={(title, getRequestId) =>
                execute(
                  () => commands.createProject({ title, id: getRequestId() }),
                  (project) =>
                    setProjects((current) => [
                      project,
                      ...current.filter((row) => row.id !== project.id),
                    ]),
                  false,
                )
              }
            />
          )
        }
      />
      {projects.length === 0 ? (
        <EmptyState
          className="rounded-lg border bg-card"
          title={labels("index.empty")}
          body={labels("index.emptyDescription")}
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <li key={project.id}>
              <Link
                href={`/projects/internal/${encodeURIComponent(project.id)}`}
                className="flex h-full min-w-0 gap-3 rounded-lg border bg-card p-4 transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                  <FolderKanban aria-hidden="true" className="size-4" />
                </span>
                <span className="min-w-0 space-y-1">
                  <span className="block font-medium [overflow-wrap:anywhere]">
                    <bdi>{project.title}</bdi>
                  </span>
                  <span className="block text-sm text-muted-foreground [overflow-wrap:anywhere]">
                    {labels("index.owner")} · <bdi>{project.owner.name}</bdi>
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
