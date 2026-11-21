"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { PageHeading } from "@/components/shell/PageHeading";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PILL_TAB, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import type { ProjectLogo } from "../brand/contracts";
import { projectLogoInput, projectTimeZoneInput } from "../brand/input";
import {
  type CoverDraft,
  ProjectBrandFields,
  ProjectTimeZoneField,
  projectCoverChange,
} from "../brand/ProjectBrandFields";
import { type ProjectCommands, type ProjectIndex, projectTitleMaxLength } from "../contracts";
import { DiscoverProjects } from "../guests/DiscoverProjects";
import { guestLabels } from "../guests/messages";
import { projectSettingsMessages } from "../settings/messages";
import { ProjectTitleDialog } from "./ProjectTitleDialog";
import { PlaneProjectDirectory } from "./planeDirectory";
import { projectsTranslator } from "./projectMessages";
import { useProjectWrites } from "./projectWrites";

export function InternalProjectsList({
  initial,
  commands,
  locale,
  actorId,
}: {
  initial: ProjectIndex;
  commands: ProjectCommands;
  locale: Locale;
  actorId?: string;
}) {
  const { numberingSystem } = useLocalePreferences();
  const labels = projectsTranslator(locale, numberingSystem);
  const settingsLabels = projectSettingsMessages[locale];
  const [projects, setProjects] = useState(initial.projects);
  const [tab, setTab] = useState("active");
  const discoverable = initial.discoverableProjects ?? [];
  const canDiscover = actorId !== undefined && discoverable.length > 0;
  const archives = projects.filter(({ archived }) => archived);
  const { execute, pending } = useProjectWrites();
  const [logo, setLogo] = useState<ProjectLogo | null>(null);
  const [cover, setCover] = useState<CoverDraft>({ kind: "existing" });
  const [timeZone, setTimeZone] = useState("UTC");

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
              onOpen={() => {
                setLogo(null);
                setCover({ kind: "existing" });
                setTimeZone("UTC");
              }}
              canSubmit={
                projectTimeZoneInput.safeParse(timeZone).success &&
                (logo === null || projectLogoInput.safeParse(logo).success)
              }
              extra={
                <details className="rounded-md border px-3 py-2">
                  <summary className="cursor-pointer text-sm font-medium">
                    {settingsLabels.brandingAndTimeZone}
                  </summary>
                  <div className="mt-3 space-y-4">
                    <ProjectBrandFields
                      logo={logo}
                      setLogo={setLogo}
                      cover={cover}
                      setCover={setCover}
                      pending={pending}
                      labels={settingsLabels}
                    />
                    <ProjectTimeZoneField
                      labels={settingsLabels}
                      value={timeZone}
                      setValue={setTimeZone}
                      pending={pending}
                    />
                  </div>
                </details>
              }
              trigger={
                <Button disabled={pending}>
                  <Plus aria-hidden="true" className="size-4" />
                  {labels("index.create")}
                </Button>
              }
              submit={(title, getRequestId) =>
                execute(
                  () =>
                    commands.createProject({
                      title,
                      id: getRequestId(),
                      ...(timeZone === "UTC" ? {} : { timeZone }),
                      ...(logo === null ? {} : { logo }),
                      ...projectCoverChange(cover),
                    }),
                  (project) => {
                    setProjects((current) => [
                      project,
                      ...current.filter((row) => row.id !== project.id),
                    ]);
                    setTab("active");
                  },
                  false,
                )
              }
            />
          )
        }
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList
          className="w-fit gap-1 rounded-md border bg-card p-1"
          aria-label={labels("navigation.internal")}
        >
          <TabsTrigger value="active" className={PILL_TAB}>
            {labels("sections.active")}
          </TabsTrigger>
          <TabsTrigger value="archive" className={PILL_TAB}>
            {labels("sections.archived")}
          </TabsTrigger>
          {canDiscover && (
            <TabsTrigger value="discover" className={PILL_TAB}>
              {guestLabels[locale].discover}
            </TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="active">
          <PlaneProjectDirectory
            projects={projects.filter(({ archived }) => !archived)}
            labels={labels}
            locale={locale}
          />
        </TabsContent>
        {canDiscover && (
          <TabsContent value="discover">
            <DiscoverProjects actorId={actorId} projects={discoverable} />
          </TabsContent>
        )}
        <TabsContent value="archive">
          {archives.length > 0 ? (
            <PlaneProjectDirectory projects={archives} labels={labels} locale={locale} />
          ) : (
            <EmptyState
              className="rounded-lg border bg-card"
              title={labels("sections.noArchives")}
              body={labels("sections.archiveDescription")}
            />
          )}
        </TabsContent>
      </Tabs>
    </section>
  );
}
