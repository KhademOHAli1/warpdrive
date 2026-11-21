"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { PageHeading } from "@/components/shell/PageHeading";
import { Button } from "@/components/ui/Button";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { type ProjectCommands, type ProjectIndex, projectTitleMaxLength } from "../contracts";
import { ProjectTitleDialog } from "./ProjectTitleDialog";
import { PlaneProjectDirectory } from "./planeDirectory";
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
                <Button disabled={pending}>
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
      <PlaneProjectDirectory projects={projects} labels={labels} locale={locale} />
    </section>
  );
}
