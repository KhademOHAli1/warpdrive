/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Adapted from apps/web/components/project/join-project-modal.tsx in Plane Community
 * v1.5.0, commit 18caf808a3af3fcabeeba7d1e8473f1367bff2d4.
 */

"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import type { DiscoverableProject } from "../contracts";
import { ProjectWriteNotice } from "../ui/ProjectTitleDialog";
import { projectsTranslator } from "../ui/projectMessages";
import { guestLabels } from "./messages";

function DiscoverProjectRow({
  project,
  actorId,
}: {
  project: DiscoverableProject;
  actorId: string;
}) {
  const { locale, numberingSystem } = useLocalePreferences();
  const labels = guestLabels[locale];
  const router = useRouter();
  const join = trpc.internalProjects.guests.joinPublic.useMutation({
    onSuccess(result) {
      if (result.ok)
        router.push(`/projects/internal/${encodeURIComponent(result.value.projectId)}`);
    },
  });
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0 space-y-0.5">
        <bdi className="block font-medium [overflow-wrap:anywhere]">{project.title}</bdi>
        <bdi className="text-sm text-muted-foreground">{project.identifier}</bdi>
        <ProjectWriteNotice
          error={
            join.data?.ok === false ? join.data.error : join.isError ? "project_unavailable" : null
          }
          labels={projectsTranslator(locale, numberingSystem)}
        />
      </div>
      <Button
        size="sm"
        variant="outline"
        disabled={join.isPending}
        onClick={() =>
          join.mutate({
            projectId: project.id,
            expectedActorId: actorId,
            csrfToken: readCsrfToken(),
          })
        }
      >
        {labels.join}
      </Button>
    </li>
  );
}

export function DiscoverProjects({
  projects,
  actorId,
}: {
  projects: DiscoverableProject[];
  actorId: string;
}) {
  const { locale } = useLocalePreferences();
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{guestLabels[locale].discoveryHelp}</p>
      <ul className="divide-y rounded-lg border bg-card">
        {projects.map((project) => (
          <DiscoverProjectRow key={project.id} project={project} actorId={actorId} />
        ))}
      </ul>
    </div>
  );
}
