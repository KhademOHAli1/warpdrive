"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageHeading } from "@/components/shell/PageHeading";
import { Switch } from "@/components/ui/Switch";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import type { ProjectSummary } from "../../contracts";
import { ProjectSettingsTabs } from "../../settings/ProjectSettingsTabs";
import { ProjectWriteNotice } from "../../ui/ProjectTitleDialog";
import { ProjectWorkspaceNav } from "../../ui/ProjectWorkspaceNav";
import { projectsTranslator } from "../../ui/projectMessages";
import { useProjectWrites } from "../../ui/projectWrites";
import { intakeMessages } from "../messages";

export function ProjectIntakeSettings({
  actorId,
  project,
  enabled,
  revision,
}: {
  actorId: string;
  project: ProjectSummary;
  enabled: boolean;
  revision: number;
}) {
  const router = useRouter();
  const { locale, numberingSystem } = useLocalePreferences();
  const labels = intakeMessages[locale];
  const projects = projectsTranslator(locale, numberingSystem);
  const [settings, setSettings] = useState({ enabled, revision });
  const write = trpc.internalProjects.intake.setEnabled.useMutation();
  const { execute, pending, error } = useProjectWrites();
  const root = `/projects/internal/${project.id}`;

  function toggle(next: boolean) {
    void execute(
      () =>
        write.mutateAsync({
          enabled: next,
          projectId: project.id,
          revision: settings.revision,
          expectedActorId: actorId,
          csrfToken: readCsrfToken(),
        }),
      (persisted) => {
        setSettings(persisted);
        router.refresh();
      },
    );
  }

  return (
    <section>
      <PageHeading
        title={projects("sections.settings")}
        crumbs={[
          { label: project.title, href: root },
          { label: projects("sections.settings"), href: `${root}/settings` },
          { label: labels.title },
        ]}
      />
      <ProjectWorkspaceNav
        projectId={project.id}
        active="settings"
        canManageSettings
        intakeEnabled={settings.enabled}
      />
      <ProjectSettingsTabs projectId={project.id} active="intake" />
      <ProjectWriteNotice error={error} labels={projects} />
      <div className="flex max-w-4xl items-start justify-between gap-4 rounded-lg border bg-card p-4">
        <div className="space-y-1">
          <h2 className="font-medium">{labels.enable}</h2>
          <p className="text-sm text-muted-foreground">{labels.settingsDescription}</p>
          {project.archived && <p className="text-sm text-muted-foreground">{labels.archived}</p>}
        </div>
        <Switch
          label={labels.enable}
          checked={settings.enabled}
          onCheckedChange={toggle}
          disabled={pending || project.archived}
        />
      </div>
    </section>
  );
}
