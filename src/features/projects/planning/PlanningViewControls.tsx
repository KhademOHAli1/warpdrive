/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Adapted from apps/web/components/views/view-list-item-action.tsx in Plane Community
 * v1.5.0, commit 18caf808a3af3fcabeeba7d1e8473f1367bff2d4.
 */

"use client";

import { Lock, LockOpen, Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import { ProjectWriteNotice } from "../ui/ProjectTitleDialog";
import { projectsTranslator } from "../ui/projectMessages";
import { planningAdvancedLabels } from "./advancedMessages";
import type { PlanningSavedView } from "./contracts";

type ViewControlProps = { actorId: string; projectId: string; view: PlanningSavedView };

export function PlanningViewFavorite({ actorId, projectId, view }: ViewControlProps) {
  const { locale, numberingSystem } = useLocalePreferences();
  const labels = planningAdvancedLabels[locale];
  const router = useRouter();
  const favorite = trpc.internalProjects.planning.setViewFavorite.useMutation({
    onSuccess(result) {
      if (result.ok) router.refresh();
    },
  });
  if (!view.canFavorite) return null;
  const selected = favorite.data?.ok === true ? favorite.data.value.favorite : view.favorite;
  const label = selected ? labels.removeFavorite : labels.addFavorite;
  return (
    <div>
      <Button
        variant="ghost"
        size="icon"
        aria-label={label}
        title={label}
        aria-pressed={selected}
        disabled={favorite.isPending}
        onClick={() =>
          favorite.mutate({
            projectId,
            viewId: view.id,
            expectedActorId: actorId,
            csrfToken: readCsrfToken(),
            favorite: !selected,
          })
        }
      >
        <Star aria-hidden className={selected ? "size-4 fill-current" : "size-4"} />
      </Button>
      <ProjectWriteNotice
        error={
          favorite.data?.ok === false
            ? favorite.data.error
            : favorite.isError
              ? "project_unavailable"
              : null
        }
        labels={projectsTranslator(locale, numberingSystem)}
      />
    </div>
  );
}

export function PlanningViewLock({ actorId, projectId, view }: ViewControlProps) {
  const { locale, numberingSystem } = useLocalePreferences();
  const labels = planningAdvancedLabels[locale];
  const router = useRouter();
  const lock = trpc.internalProjects.planning.setViewLock.useMutation({
    onSuccess(result) {
      if (result.ok) router.refresh();
    },
  });
  if (!view.canEdit || view.archived) return null;
  const current = lock.data?.ok === true ? lock.data.value : view;
  const Icon = current.locked ? LockOpen : Lock;
  return (
    <div>
      <Button
        variant="outline"
        size="sm"
        disabled={lock.isPending}
        onClick={() =>
          lock.mutate({
            projectId,
            viewId: view.id,
            expectedActorId: actorId,
            csrfToken: readCsrfToken(),
            revision: current.revision,
            locked: !current.locked,
          })
        }
      >
        <Icon aria-hidden className="size-4" />
        {current.locked ? labels.unlock : labels.lock}
      </Button>
      <ProjectWriteNotice
        error={
          lock.data?.ok === false ? lock.data.error : lock.isError ? "project_unavailable" : null
        }
        labels={projectsTranslator(locale, numberingSystem)}
      />
    </div>
  );
}
