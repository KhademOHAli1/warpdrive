/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Adapted from Plane Community v1.5.0, apps/web/components/project/publish-project/modal.tsx.
 */
"use client";

import { Copy, ExternalLink } from "lucide-react";
import { useId, useRef, useState } from "react";
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
import { Switch } from "@/components/ui/Switch";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import type { ProjectSummary } from "../contracts";
import { ProjectSettingsTabs } from "../settings/ProjectSettingsTabs";
import { ProjectWriteNotice } from "../ui/ProjectTitleDialog";
import { ProjectWorkspaceNav } from "../ui/ProjectWorkspaceNav";
import { projectsTranslator } from "../ui/projectMessages";
import { useProjectWrites } from "../ui/projectWrites";
import {
  type ProjectPublicationSettings,
  type PublicationOptions,
  projectPublicationPath,
} from "./contracts";
import { publicationMessages } from "./messages";

const optionKeys = [
  "listEnabled",
  "boardEnabled",
  "showWorkItems",
  "showBranding",
  "allowIntake",
] as const;
function options(settings: ProjectPublicationSettings): PublicationOptions {
  const { listEnabled, boardEnabled, showWorkItems, showBranding, allowIntake } = settings;
  return { listEnabled, boardEnabled, showWorkItems, showBranding, allowIntake };
}

export function PublicationSettings({
  actorId,
  project,
  initial,
}: {
  actorId: string;
  project: ProjectSummary;
  initial: ProjectPublicationSettings;
}) {
  const { locale, numberingSystem } = useLocalePreferences();
  const labels = publicationMessages[locale];
  const projects = projectsTranslator(locale, numberingSystem);
  const id = useId();
  const [settings, setSettings] = useState(initial);
  const [draft, setDraft] = useState(options(initial));
  const [status, setStatus] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [fullLink, setFullLink] = useState<string | null>(null);
  const linkField = useRef<HTMLInputElement | null>(null);
  const write = trpc.internalProjects.publication.save.useMutation({ gcTime: 0 });
  const { pending, execute, error } = useProjectWrites();
  const changed = optionKeys.some((key) => settings[key] !== draft[key]);
  const sharePath = settings.anchor === null ? null : projectPublicationPath(settings.anchor);
  const frozen = pending || project.archived;
  const privacy = `${BLOCK_CLASS} ph-no-capture`;

  function setOption(option: (typeof optionKeys)[number], checked: boolean) {
    setStatus(null);
    setDraft((current) => ({ ...current, [option]: checked }));
  }

  async function persist(published: boolean) {
    if (frozen || (published && !draft.listEnabled && !draft.boardEnabled)) return;
    setStatus(null);
    await execute(
      () =>
        write.mutateAsync({
          projectId: project.id,
          revision: settings.revision,
          published,
          ...(published ? draft : options(settings)),
          expectedActorId: actorId,
          csrfToken: readCsrfToken(),
        }),
      (next) => {
        setSettings(next);
        setDraft(options(next));
        setFullLink(null);
        setConfirm(false);
        setStatus(labels.saved);
      },
    );
  }

  async function copyLink(path: string) {
    const url = new URL(path, window.location.origin).href;
    setFullLink(url);
    try {
      await navigator.clipboard.writeText(url);
      setStatus(labels.copied);
    } catch {
      linkField.current?.focus();
      linkField.current?.select();
      setStatus(labels.copyFailure);
    }
  }

  return (
    <section className={privacy}>
      <PageHeading
        title={labels.publication}
        crumbs={[
          { label: project.title, href: `/projects/internal/${project.id}` },
          { label: labels.publication },
        ]}
      />
      <ProjectWorkspaceNav
        projectId={project.id}
        active="settings"
        canManageSettings
        intakeEnabled={settings.intakeEnabled}
      />
      <ProjectSettingsTabs projectId={project.id} active="publication" />
      <div className="max-w-4xl space-y-4">
        <ProjectWriteNotice error={error} labels={projects} />
        {status !== null && (
          <p role="status" className="text-sm text-muted-foreground">
            {status}
          </p>
        )}
        {project.archived && (
          <p className="rounded-lg border bg-muted/50 p-3 text-sm">{labels.archived}</p>
        )}
        <div className="space-y-4 rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">{labels.visibility}</p>
          <fieldset disabled={frozen} className="flex flex-wrap gap-4">
            <legend className="mb-2 text-sm font-medium">{labels.layouts}</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.listEnabled}
                onChange={(event) => setOption("listEnabled", event.target.checked)}
              />
              {labels.list}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.boardEnabled}
                onChange={(event) => setOption("boardEnabled", event.target.checked)}
              />
              {labels.board}
            </label>
          </fieldset>
          <div className="space-y-4 border-t pt-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{labels.showWorkItems}</p>
                <p className="text-sm text-muted-foreground">{labels.showWorkItemsHelp}</p>
              </div>
              <Switch
                label={labels.showWorkItems}
                checked={draft.showWorkItems}
                disabled={frozen}
                onCheckedChange={(checked) => setOption("showWorkItems", checked)}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{labels.showBranding}</p>
                <p className="text-sm text-muted-foreground">{labels.showBrandingHelp}</p>
              </div>
              <Switch
                label={labels.showBranding}
                checked={draft.showBranding}
                disabled={frozen}
                onCheckedChange={(checked) => setOption("showBranding", checked)}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{labels.allowIntake}</p>
                {!settings.intakeEnabled && (
                  <p className="text-sm text-muted-foreground">{labels.intakeDisabled}</p>
                )}
              </div>
              <Switch
                label={labels.allowIntake}
                checked={draft.allowIntake}
                disabled={frozen || (!settings.intakeEnabled && !draft.allowIntake)}
                onCheckedChange={(checked) => setOption("allowIntake", checked)}
              />
            </div>
          </div>
          {!project.archived && (
            <Button
              type="button"
              disabled={
                pending ||
                (!draft.listEnabled && !draft.boardEnabled) ||
                (sharePath !== null && !changed)
              }
              onClick={() => void persist(true)}
            >
              {pending ? labels.busy : sharePath === null ? labels.publish : labels.update}
            </Button>
          )}
        </div>
        {sharePath !== null && !project.archived && (
          <div className="space-y-3 rounded-lg border bg-card p-4">
            <label className="text-sm font-medium" htmlFor={id}>
              {labels.publishedLink}
            </label>
            <Input id={id} dir="ltr" ref={linkField} value={fullLink ?? sharePath} readOnly />
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => void copyLink(sharePath)}>
                <Copy aria-hidden="true" /> {labels.copy}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => window.open(sharePath, "_blank", "noopener,noreferrer")}
              >
                <ExternalLink aria-hidden="true" /> {labels.open}
              </Button>
              <AlertDialog
                open={confirm}
                onOpenChange={(open) => {
                  if (!pending) setConfirm(open);
                }}
              >
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="outline" disabled={pending}>
                    {labels.unpublish}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className={privacy}>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{labels.unpublish}</AlertDialogTitle>
                    <AlertDialogDescription>{labels.unpublishHelp}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <ProjectWriteNotice error={error} labels={projects} />
                  <AlertDialogFooter>
                    <AlertDialogCancel asChild>
                      <Button type="button" variant="outline" disabled={pending}>
                        {labels.cancel}
                      </Button>
                    </AlertDialogCancel>
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={pending}
                      onClick={() => void persist(false)}
                    >
                      {pending ? labels.busy : labels.unpublish}
                    </Button>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
