/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Adapted from apps/web/components/views/quick-actions.tsx in Plane Community
 * v1.5.0, commit 18caf808a3af3fcabeeba7d1e8473f1367bff2d4.
 */

"use client";

import { ExternalLink, Link2, MoreHorizontal, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import { ProjectWriteNotice } from "../ui/ProjectTitleDialog";
import { projectsTranslator } from "../ui/projectMessages";
import { planningAdvancedLabels } from "./advancedMessages";
import type { PlanningSavedView } from "./contracts";
import { openPlanningViewPath, planningPath } from "./paths";

export function PlanningViewQuickActions({
  projectId,
  actorId,
  view,
  detail = false,
}: {
  projectId: string;
  actorId: string;
  view: PlanningSavedView;
  detail?: boolean;
}) {
  const { locale, numberingSystem } = useLocalePreferences();
  const labels = planningAdvancedLabels[locale];
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"copiedLink" | "copyLinkFailed" | null>(null);
  const url = view.archived
    ? planningPath(projectId, "views", view.id)
    : openPlanningViewPath(projectId, view.id);
  const remove = trpc.internalProjects.planning.deleteView.useMutation({
    onSuccess(result) {
      if (!result.ok) return;
      if (detail) router.replace(planningPath(projectId, "views"));
      router.refresh();
    },
  });

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(new URL(url, window.location.origin).href);
      setCopyStatus("copiedLink");
    } catch {
      setCopyStatus("copyLinkFailed");
    }
  }

  return (
    <div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`${labels.viewActions} · ${view.title}`}
            disabled={remove.isPending}
          >
            <MoreHorizontal aria-hidden="true" className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <a href={url} target="_blank" rel="noreferrer">
              <ExternalLink aria-hidden="true" className="size-4" />
              {labels.openNewTab}
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void copyLink()}>
            <Link2 aria-hidden="true" className="size-4" />
            {labels.copyLink}
          </DropdownMenuItem>
          {view.canDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirm(true)}>
                <Trash2 aria-hidden="true" className="size-4" />
                {labels.deleteView}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {view.canDelete && (
        <ConfirmDialog
          open={confirm}
          onOpenChange={setConfirm}
          title={labels.confirmDeleteView}
          description={labels.deleteViewDescription}
          confirmLabel={labels.deleteView}
          destructive
          pending={remove.isPending}
          onConfirm={() =>
            remove.mutate({
              projectId,
              viewId: view.id,
              expectedActorId: actorId,
              csrfToken: readCsrfToken(),
              revision: view.revision,
            })
          }
        />
      )}
      {copyStatus !== null && (
        <p role="status" className="text-xs text-muted-foreground">
          {labels[copyStatus]}
        </p>
      )}
      <ProjectWriteNotice
        error={
          remove.data?.ok === false
            ? remove.data.error
            : remove.isError
              ? "project_unavailable"
              : null
        }
        labels={projectsTranslator(locale, numberingSystem)}
      />
    </div>
  );
}
