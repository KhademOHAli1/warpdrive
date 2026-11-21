/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Adapted from Plane Community v1.5.0 apps/web/components/automation/auto-{archive,close}-automation.tsx.
 */

"use client";

import Link from "next/link";
import { useState } from "react";
import { PageHeading } from "@/components/shell/PageHeading";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { ToggleField } from "@/components/ui/ToggleField";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import { type ProjectWorkspace, projectItemKey } from "../contracts";
import { ProjectSettingsTabs } from "../settings/ProjectSettingsTabs";
import { ProjectWriteNotice } from "../ui/ProjectTitleDialog";
import { ProjectWorkspaceNav } from "../ui/ProjectWorkspaceNav";
import { projectsTranslator } from "../ui/projectMessages";
import { useProjectFormatters } from "../ui/useProjectFormatters";
import type { ProjectAutomationSettings } from "./contracts";
import { type ProjectAutomationMessages, projectAutomationMessages } from "./messages";

type RecentAutomation = {
  id: string;
  itemId: string;
  sequenceNumber: number | null;
  itemArchivedAt: Date | null;
  title: string;
  kind: "archived" | "closed";
  recordedAt: Date;
};

const durationPresets = [1, 3, 6, 9, 12];
function DurationControl({
  value,
  disabled,
  labels,
  rule,
  change,
}: {
  value: number;
  disabled: boolean;
  labels: ProjectAutomationMessages;
  rule: string;
  change: (months: number) => void;
}) {
  const format = useProjectFormatters();
  const [custom, setCustom] = useState(false);
  const [duration, setDuration] = useState(String(value));
  const options = Array.from(new Set([...durationPresets, value])).sort((a, b) => a - b);
  const months = Number(duration);
  const valid = Number.isInteger(months) && months >= 1 && months <= 12;
  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium">{labels.duration}</span>
      <Select
        ariaLabel={`${rule} · ${labels.duration}`}
        disabled={disabled}
        value={String(value)}
        options={[
          ...options.map((option) => ({
            value: String(option),
            label: `${format.number(option)} ${option === 1 ? labels.month : labels.months.toLocaleLowerCase()}`,
          })),
          { value: "custom", label: labels.custom },
        ]}
        onChange={(choice) => {
          if (choice === "custom") {
            setDuration(String(value));
            setCustom(true);
          } else {
            setCustom(false);
            change(Number(choice));
          }
        }}
      />
      {custom && (
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid || disabled) return;
            change(months);
            setCustom(false);
          }}
        >
          <Input
            type="number"
            min={1}
            max={12}
            required
            className="w-24"
            value={duration}
            aria-label={`${rule} · ${labels.months}`}
            onChange={(event) => setDuration(event.target.value)}
          />
          <Button type="submit" variant="outline" disabled={disabled || !valid}>
            {labels.apply}
          </Button>
        </form>
      )}
    </div>
  );
}

export function ProjectAutomationClient({
  actorId,
  workspace,
  initial,
  recent,
}: {
  actorId: string;
  workspace: ProjectWorkspace;
  initial: ProjectAutomationSettings;
  recent: RecentAutomation[];
}) {
  const { locale, numberingSystem } = useLocalePreferences();
  const labels = projectAutomationMessages[locale];
  const format = useProjectFormatters();
  const [settings, setSettings] = useState(initial);
  const save = trpc.internalProjects.automation.save.useMutation({
    onSuccess(result) {
      if (result.ok) setSettings(result.value);
    },
  });
  const project = workspace.project;
  const cancelled = workspace.states.filter(({ category }) => category === "cancelled");
  const disabled = save.isPending || !workspace.canEdit;
  const firstState = cancelled[0]?.id;

  function change(patch: Partial<Omit<ProjectAutomationSettings, "revision">>) {
    if (disabled) return;
    save.mutate({
      ...settings,
      ...patch,
      projectId: project.id,
      expectedActorId: actorId,
      csrfToken: readCsrfToken(),
    });
  }

  return (
    <section className={`${BLOCK_CLASS} ph-no-capture`}>
      <PageHeading
        title={labels.title}
        crumbs={[
          { label: project.title, href: `/projects/internal/${project.id}` },
          { label: labels.title },
        ]}
      />
      <ProjectWorkspaceNav
        projectId={project.id}
        active="settings"
        canManageSettings
        intakeEnabled={workspace.settings.intakeEnabled}
      />
      <ProjectSettingsTabs projectId={project.id} active="automations" />
      <div className="max-w-3xl space-y-4">
        <ProjectWriteNotice
          labels={projectsTranslator(locale, numberingSystem)}
          error={
            save.isError ? "project_unavailable" : save.data?.ok === false ? save.data.error : null
          }
        />
        <section className="rounded-lg border bg-card p-4">
          <ToggleField
            label={labels.archiveLabel}
            control="switch"
            checked={settings.archiveAfterMonths > 0}
            disabled={disabled}
            onCheckedChange={(on) => change({ archiveAfterMonths: on ? 1 : 0 })}
          />
          <p className="mt-2 text-sm text-muted-foreground">{labels.archiveDescription}</p>
          {settings.archiveAfterMonths > 0 && (
            <div className="mt-4 max-w-sm border-t pt-4">
              <DurationControl
                rule={labels.archiveLabel}
                labels={labels}
                value={settings.archiveAfterMonths}
                disabled={disabled}
                change={(months) => change({ archiveAfterMonths: months })}
              />
            </div>
          )}
        </section>
        <section className="rounded-lg border bg-card p-4">
          <ToggleField
            label={labels.closeLabel}
            control="switch"
            checked={settings.closeAfterMonths > 0}
            disabled={disabled || firstState === undefined}
            onCheckedChange={(on) => {
              if (firstState !== undefined)
                change({ closeAfterMonths: on ? 1 : 0, closeStateId: on ? firstState : null });
            }}
          />
          <p className="mt-2 text-sm text-muted-foreground">{labels.closeDescription}</p>
          {firstState === undefined && (
            <p className="mt-3 text-sm">
              {labels.needState}{" "}
              <Link
                className="font-medium text-primary underline"
                href={`/projects/internal/${project.id}/settings/states`}
              >
                {labels.states}
              </Link>
            </p>
          )}
          {settings.closeAfterMonths > 0 && (
            <div className="mt-4 grid gap-4 border-t pt-4 sm:grid-cols-2">
              <DurationControl
                rule={labels.closeLabel}
                labels={labels}
                value={settings.closeAfterMonths}
                disabled={disabled}
                change={(months) => change({ closeAfterMonths: months })}
              />
              <div className="space-y-2">
                <p className="text-sm font-medium">{labels.state}</p>
                <Select
                  ariaLabel={labels.state}
                  disabled={disabled}
                  value={settings.closeStateId ?? ""}
                  options={cancelled.map(({ id, name }) => ({ value: id, label: name }))}
                  onChange={(id) => change({ closeStateId: id })}
                />
              </div>
            </div>
          )}
        </section>
        <section className="rounded-lg border bg-card p-4">
          <h2 className="text-sm font-semibold">{labels.recent}</h2>
          {recent.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">{labels.noActivity}</p>
          ) : (
            <ul className="mt-2 divide-y text-sm">
              {recent.map(
                ({ id, title, sequenceNumber, kind, recordedAt, itemId, itemArchivedAt }) => (
                  <li key={id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <Link
                      className="min-w-0 hover:text-primary"
                      href={`/projects/internal/${project.id}${itemArchivedAt === null ? "" : "/archive"}?item=${itemId}`}
                    >
                      {sequenceNumber !== null && (
                        <bdi className="me-2 text-muted-foreground">
                          {projectItemKey(project.identifier, sequenceNumber)}
                        </bdi>
                      )}
                      <bdi>{title}</bdi>
                    </Link>
                    <span className="text-muted-foreground">
                      {labels[kind]} · {format.dateTime(recordedAt.toISOString())}
                    </span>
                  </li>
                ),
              )}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}
