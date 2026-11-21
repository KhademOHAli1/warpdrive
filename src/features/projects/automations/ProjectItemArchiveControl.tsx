"use client";

import { Archive, ArchiveRestore } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import type { ProjectItem } from "../contracts";
import { ProjectWriteNotice } from "../ui/ProjectTitleDialog";
import { projectsTranslator } from "../ui/projectMessages";
import { projectAutomationMessages } from "./messages";

export function ProjectItemArchiveControl({
  actorId,
  projectId,
  item,
  onChanged,
  disabled = false,
}: {
  actorId: string;
  projectId: string;
  item: ProjectItem;
  onChanged: () => void;
  disabled?: boolean;
}) {
  const { locale, numberingSystem } = useLocalePreferences();
  const labels = projectAutomationMessages[locale];
  const archived = item.archivedAt !== null;
  const mutation = trpc.internalProjects.automation.setItemArchived.useMutation({
    onSuccess(result) {
      if (result.ok) onChanged();
    },
  });
  const Icon = archived ? ArchiveRestore : Archive;
  return (
    <div>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || mutation.isPending}
        onClick={() =>
          mutation.mutate({
            projectId,
            itemId: item.id,
            revision: item.revision,
            archived: !archived,
            expectedActorId: actorId,
            csrfToken: readCsrfToken(),
          })
        }
      >
        <Icon aria-hidden="true" className="size-4" />
        {archived ? labels.restoreItem : labels.archiveItem}
      </Button>
      <ProjectWriteNotice
        labels={projectsTranslator(locale, numberingSystem)}
        error={
          mutation.isError
            ? "project_unavailable"
            : mutation.data?.ok === false
              ? mutation.data.error
              : null
        }
      />
    </div>
  );
}
