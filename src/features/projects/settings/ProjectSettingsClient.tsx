/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Adapted from Plane Community v1.5.0,
 * apps/web/app/(all)/[workspaceSlug]/(settings)/settings/projects/[projectId]/page.tsx and
 * apps/web/components/project/settings/control-section.tsx, with member defaults
 * from apps/web/components/project/project-settings-member-defaults.tsx.
 */

"use client";

import { Archive, ArchiveRestore } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useId, useState } from "react";
import { PageHeading } from "@/components/shell/PageHeading";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { cn } from "@/lib/utils";
import { readCsrfToken } from "@/utils/csrfCookie";
import {
  saveProjectSettingsAction,
  saveProjectStatesAction,
  setProjectArchivedAction,
} from "../actions";
import type { ProjectLogo } from "../brand/contracts";
import { projectLogoInput, projectTimeZoneInput } from "../brand/input";
import {
  type CoverDraft,
  ProjectBrandFields,
  ProjectTimeZoneField,
  projectCoverChange,
} from "../brand/ProjectBrandFields";
import {
  type ProjectResult,
  type ProjectWorkspace,
  projectDescriptionMaxLength,
  projectIdentifierMaxLength,
  projectTitleMaxLength,
  type SaveProjectSettingsInput,
} from "../contracts";
import { ProjectWriteNotice } from "../ui/ProjectTitleDialog";
import { ProjectWorkspaceNav } from "../ui/ProjectWorkspaceNav";
import { projectsTranslator } from "../ui/projectMessages";
import { useProjectWrites } from "../ui/projectWrites";
import { type ProjectSettingsMessages, projectSettingsMessages } from "./messages";
import { ProjectSettingsTabs } from "./ProjectSettingsTabs";
import { ProjectStateGroups } from "./ProjectStateGroups";

export type ProjectSettingsSection = "general" | "states";
type DetailsInput = Omit<SaveProjectSettingsInput, "projectId" | "revision">;
type DetailsDraft = Required<
  Pick<
    DetailsInput,
    "title" | "identifier" | "description" | "leadUserId" | "defaultAssigneeId" | "timeZone"
  >
>;

export function ProjectSettingsClient({
  actorId,
  initial,
  section,
}: {
  actorId: string;
  initial: ProjectWorkspace;
  section: ProjectSettingsSection;
}) {
  const { locale, numberingSystem } = useLocalePreferences();
  const labels = projectSettingsMessages[locale];
  const projectLabels = projectsTranslator(locale, numberingSystem);
  const [workspace, setWorkspace] = useState(initial);
  const [saved, setSaved] = useState(false);
  const { execute, pending, error } = useProjectWrites();
  const router = useRouter();
  const id = workspace.project.id;
  const target = { projectId: id, revision: workspace.settings.revision };

  function save(write: () => Promise<ProjectResult<ProjectWorkspace>>) {
    setSaved(false);
    return execute(write, (next) => {
      setWorkspace(next);
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div className={cn("min-w-0", BLOCK_CLASS, "ph-no-capture")}>
      <PageHeading
        title={labels.settings}
        crumbs={[
          { label: workspace.project.title, href: `/projects/internal/${id}` },
          { label: labels.settings },
        ]}
      />
      <ProjectWorkspaceNav
        projectId={id}
        active="settings"
        canManageSettings
        intakeEnabled={workspace.settings.intakeEnabled}
      />
      <ProjectSettingsTabs projectId={id} active={section} />
      <div className="max-w-4xl space-y-5">
        <ProjectWriteNotice error={error} labels={projectLabels} />
        {saved && (
          <p role="status" className="text-sm text-muted-foreground">
            {labels.saved}
          </p>
        )}
        {workspace.project.archived && (
          <p className="rounded-lg border bg-muted/50 p-3 text-sm">{labels.archived}</p>
        )}
        {section === "general" && (
          <>
            {!workspace.project.archived && (
              <ProjectDetailsFields
                key={workspace.settings.revision}
                workspace={workspace}
                labels={labels}
                pending={pending}
                save={(details) =>
                  void save(() =>
                    saveProjectSettingsAction(actorId, { ...target, ...details }, readCsrfToken()),
                  )
                }
              />
            )}
            <ProjectArchiveControl
              archived={workspace.project.archived}
              labels={labels}
              pending={pending}
              report={error}
              run={async () =>
                (
                  await save(() =>
                    setProjectArchivedAction(
                      actorId,
                      { ...target, archived: !workspace.project.archived },
                      readCsrfToken(),
                    ),
                  )
                ).ok
              }
            />
          </>
        )}
        {section === "states" &&
          (workspace.project.archived ? (
            <ul className="divide-y rounded-lg border">
              {workspace.states.map((state) => (
                <li key={state.id} className="flex items-center gap-2 p-3 text-sm">
                  <span
                    className="size-2.5 rounded-full"
                    style={{ backgroundColor: state.color }}
                    aria-hidden="true"
                  />
                  <bdi>{state.name}</bdi>
                  <span className="text-muted-foreground">{labels[state.category]}</span>
                </li>
              ))}
            </ul>
          ) : (
            <ProjectStateGroups
              key={workspace.settings.revision}
              initial={workspace}
              labels={labels}
              pending={pending}
              save={(states) =>
                void save(() =>
                  saveProjectStatesAction(actorId, { ...target, states }, readCsrfToken()),
                )
              }
            />
          ))}
      </div>
    </div>
  );
}

function ProjectDetailsFields({
  workspace,
  labels,
  pending,
  save,
}: {
  workspace: ProjectWorkspace;
  labels: ProjectSettingsMessages;
  pending: boolean;
  save: (details: DetailsInput) => void;
}) {
  const fields = useId();
  const { leadUserId, defaultAssigneeId, description } = workspace.settings;
  const savedTimeZone = workspace.settings.timeZone ?? "UTC";
  const [logo, setLogo] = useState<ProjectLogo | null>(workspace.project.logo ?? null);
  const [cover, setCover] = useState<CoverDraft>({ kind: "existing" });
  const [draft, setDraft] = useState<DetailsDraft>({
    title: workspace.project.title,
    identifier: workspace.project.identifier,
    description,
    leadUserId,
    defaultAssigneeId,
    timeZone: savedTimeZone,
  });
  const unchanged =
    draft.title.trim() === workspace.project.title &&
    draft.identifier === workspace.project.identifier &&
    draft.description === description &&
    draft.leadUserId === leadUserId &&
    draft.defaultAssigneeId === defaultAssigneeId &&
    draft.timeZone === savedTimeZone &&
    JSON.stringify(logo) === JSON.stringify(workspace.project.logo ?? null) &&
    cover.kind === "existing";
  const valid =
    draft.title.trim() !== "" &&
    /^[A-Z0-9]{1,10}$/u.test(draft.identifier) &&
    projectTimeZoneInput.safeParse(draft.timeZone).success &&
    (logo === null || projectLogoInput.safeParse(logo).success);
  const options = [
    { value: "", label: labels.none },
    ...workspace.assignees.map(({ id, name }) => ({ value: id, label: name })),
  ];
  const knownPeople = [workspace.project.owner, ...workspace.members.map(({ person }) => person)];

  function set<K extends keyof DetailsDraft>(field: K, value: DetailsDraft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function historicalName(id: string | null) {
    if (id === null || options.some(({ value }) => value === id)) return undefined;
    return knownPeople.find((person) => person.id === id)?.name;
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid || unchanged || pending) return;
    save({ ...draft, title: draft.title.trim(), logo, ...projectCoverChange(cover) });
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border bg-card p-4">
      <div className="grid gap-2">
        <label htmlFor={`${fields}-title`} className="text-sm font-medium">
          {labels.name}
        </label>
        <Input
          id={`${fields}-title`}
          value={draft.title}
          maxLength={projectTitleMaxLength}
          required
          disabled={pending}
          dir="auto"
          onChange={(event) => set("title", event.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <label htmlFor={`${fields}-identifier`} className="text-sm font-medium">
          {labels.identifier}
        </label>
        <Input
          id={`${fields}-identifier`}
          value={draft.identifier}
          aria-describedby={`${fields}-identifier-help`}
          maxLength={projectIdentifierMaxLength}
          required
          dir="ltr"
          className="max-w-40 font-mono"
          disabled={pending}
          onChange={(event) => set("identifier", event.target.value.toUpperCase())}
        />
        <p id={`${fields}-identifier-help`} className="text-sm text-muted-foreground">
          {labels.identifierHelp}
        </p>
      </div>
      <div className="grid gap-2">
        <label htmlFor={`${fields}-description`} className="text-sm font-medium">
          {labels.description}
        </label>
        <Textarea
          id={`${fields}-description`}
          value={draft.description}
          maxLength={projectDescriptionMaxLength}
          disabled={pending}
          dir="auto"
          rows={5}
          onChange={(event) => set("description", event.target.value)}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid content-start gap-2">
          <span className="text-sm font-medium">{labels.lead}</span>
          <Select
            ariaLabel={labels.lead}
            options={options}
            value={draft.leadUserId ?? ""}
            triggerContent={historicalName(draft.leadUserId)}
            contentClassName={cn(BLOCK_CLASS, "ph-no-capture")}
            disabled={pending}
            onChange={(id) => set("leadUserId", id || null)}
          />
        </div>
        <div className="grid gap-2">
          <span className="text-sm font-medium">{labels.defaultAssignee}</span>
          <Select
            ariaLabel={labels.defaultAssignee}
            options={options}
            value={draft.defaultAssigneeId ?? ""}
            triggerContent={historicalName(draft.defaultAssigneeId)}
            contentClassName={cn(BLOCK_CLASS, "ph-no-capture")}
            disabled={pending}
            onChange={(id) => set("defaultAssigneeId", id || null)}
          />
          <p className="text-sm text-muted-foreground">{labels.defaultAssigneeHelp}</p>
        </div>
      </div>
      <ProjectTimeZoneField
        labels={labels}
        value={draft.timeZone}
        pending={pending}
        setValue={(timeZone) => set("timeZone", timeZone)}
      />
      <ProjectBrandFields
        project={workspace.project}
        logo={logo}
        setLogo={setLogo}
        cover={cover}
        setCover={setCover}
        labels={labels}
        pending={pending}
      />
      <Button type="submit" disabled={pending || unchanged || !valid}>
        {pending ? labels.saving : labels.save}
      </Button>
    </form>
  );
}

function ProjectArchiveControl({
  archived,
  labels,
  pending,
  report,
  run,
}: {
  archived: boolean;
  labels: ProjectSettingsMessages;
  pending: boolean;
  report: ReturnType<typeof useProjectWrites>["error"];
  run: () => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const { locale, numberingSystem } = useLocalePreferences();
  const projectLabels = projectsTranslator(locale, numberingSystem);
  const title = archived ? labels.restore : labels.archive;
  const description = archived ? labels.restoreDescription : labels.archiveDescription;
  const Icon = archived ? ArchiveRestore : Archive;
  async function confirm() {
    if (await run()) setOpen(false);
  }
  return (
    <section className="flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-card p-4">
      <div className="space-y-1">
        <h2 className="text-sm font-medium">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <AlertDialog
        open={open}
        onOpenChange={(value) => {
          if (!pending) setOpen(value);
        }}
      >
        <AlertDialogTrigger asChild>
          <Button type="button" variant="outline" disabled={pending}>
            <Icon aria-hidden="true" /> {title}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent className={cn(BLOCK_CLASS, "ph-no-capture")}>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          <ProjectWriteNotice error={report} labels={projectLabels} />
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button type="button" variant="outline" disabled={pending}>
                {labels.cancel}
              </Button>
            </AlertDialogCancel>
            <Button type="button" disabled={pending} onClick={() => void confirm()}>
              {pending ? labels.saving : title}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
