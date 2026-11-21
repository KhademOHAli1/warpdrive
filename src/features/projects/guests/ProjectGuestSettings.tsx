"use client";

import { type FormEvent, useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Select } from "@/components/ui/Select";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import type { ProjectSettings, ProjectSummary, ProjectVisibility } from "../contracts";
import { ProjectWriteNotice } from "../ui/ProjectTitleDialog";
import { projectsTranslator } from "../ui/projectMessages";
import { guestLabels } from "./messages";

export function ProjectGuestSettings({
  actorId,
  project,
  settings,
}: {
  actorId: string;
  project: ProjectSummary;
  settings: ProjectSettings;
}) {
  const { locale, numberingSystem } = useLocalePreferences();
  const labels = guestLabels[locale];
  const guestToggleId = useId();
  const [visibility, setVisibility] = useState<ProjectVisibility>(settings.visibility ?? "private");
  const [guestViewAllFeatures, setGuestViewAllFeatures] = useState(
    settings.guestViewAllFeatures ?? false,
  );
  const save = trpc.internalProjects.guests.saveAccess.useMutation();
  const current = save.data?.ok === true ? save.data.value : settings;
  const changed =
    (current.visibility ?? "private") !== visibility ||
    (current.guestViewAllFeatures ?? false) !== guestViewAllFeatures;
  const disabled = project.archived || save.isPending;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!disabled && changed)
      save.mutate({
        projectId: project.id,
        expectedActorId: actorId,
        csrfToken: readCsrfToken(),
        revision: current.revision,
        visibility,
        guestViewAllFeatures,
      });
  }

  return (
    <form onSubmit={submit} className="max-w-2xl space-y-4 rounded-lg border bg-card p-4">
      <div className="space-y-2">
        <p className="text-sm font-medium">{labels.visibility}</p>
        <Select
          ariaLabel={labels.visibility}
          value={visibility}
          disabled={disabled}
          onChange={(choice) => setVisibility(choice === "workspace" ? "workspace" : "private")}
          options={[
            { value: "private", label: labels.private },
            { value: "workspace", label: labels.workspace },
          ]}
        />
        <p className="text-sm text-muted-foreground">{labels.discoveryHelp}</p>
      </div>
      <div className="space-y-2">
        <label htmlFor={guestToggleId} className="flex items-center gap-2 text-sm font-medium">
          <Checkbox
            id={guestToggleId}
            checked={guestViewAllFeatures}
            disabled={disabled}
            onCheckedChange={setGuestViewAllFeatures}
            label={labels.guestAll}
          />
          {labels.guestAll}
        </label>
        <p className="text-sm text-muted-foreground">{labels.guestHelp}</p>
      </div>
      <Button type="submit" disabled={disabled || !changed}>
        {labels.save}
      </Button>
      {save.data?.ok === true && !changed && (
        <p role="status" className="text-sm text-muted-foreground">
          {labels.saved}
        </p>
      )}
      <ProjectWriteNotice
        error={
          save.data?.ok === false ? save.data.error : save.isError ? "project_unavailable" : null
        }
        labels={projectsTranslator(locale, numberingSystem)}
      />
    </form>
  );
}
