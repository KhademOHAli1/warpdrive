/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// Adapted from Plane Community v1.5.0 (18caf808a3af3fcabeeba7d1e8473f1367bff2d4),
// apps/web/components/project/{card-list,card}.tsx.
import { ExternalLink, FolderKanban, Link2, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { buttonVariants } from "@/components/ui/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/utils";
import type { ProjectSummary } from "../contracts";
import type { ProjectsTranslator } from "./projectMessages";
import { useProjectFormatters } from "./useProjectFormatters";

type CardProps = { project: ProjectSummary; labels: ProjectsTranslator };

function ProjectCard({ project, labels }: CardProps) {
  const format = useProjectFormatters();
  const [copyStatus, setCopyStatus] = useState<"copied" | "copyError" | null>(null);
  const projectLink = `/projects/internal/${encodeURIComponent(project.id)}`;

  async function handleCopyText() {
    try {
      await navigator.clipboard.writeText(new URL(projectLink, window.location.origin).href);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("copyError");
    }
  }

  return (
    <li className="group/project-card relative flex h-full w-full flex-col justify-between overflow-hidden rounded-lg border bg-card transition-colors hover:border-ring/50">
      <Link
        href={projectLink}
        className="flex h-full min-w-0 flex-col focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <div className="relative h-16 w-full rounded-t bg-muted/55">
          <div className="absolute start-3 top-3 grid size-9 place-items-center rounded-md bg-primary/10 text-primary">
            <FolderKanban aria-hidden="true" className="size-4" />
          </div>
        </div>
        <div className="w-full space-y-3 px-4 pb-4 pt-3">
          <h3 className="text-sm font-semibold [overflow-wrap:anywhere]">
            <bdi>{project.title}</bdi>
          </h3>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>{labels("index.owner")}</span>
            <bdi className="min-w-0 font-medium text-foreground [overflow-wrap:anywhere]">
              {project.owner.name}
            </bdi>
          </div>
        </div>
        <div className="mt-auto flex items-center border-t px-4 py-2.5 text-xs text-muted-foreground">
          {labels("index.created", {
            date: format.dateTime(project.createdAt, {
              year: "numeric",
              month: "short",
              day: "numeric",
            }),
          })}
        </div>
      </Link>
      <div className="absolute end-3 top-3">
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={labels("index.projectActions", { title: project.title })}
            className={cn(buttonVariants({ variant: "outline", size: "icon" }), "size-8 bg-card")}
          >
            <MoreHorizontal aria-hidden="true" className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <a href={projectLink} target="_blank" rel="noreferrer">
                <ExternalLink aria-hidden="true" className="size-4" />
                {labels("index.openNewTab")}
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void handleCopyText()}>
              <Link2 aria-hidden="true" className="size-4" />
              {labels("index.copyLink")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {copyStatus !== null && (
        <p role="status" className="px-4 pb-2.5 text-xs text-muted-foreground">
          {labels(`index.${copyStatus}`)}
        </p>
      )}
    </li>
  );
}

export function PlaneDirectoryCards({
  projects,
  labels,
}: {
  projects: ProjectSummary[];
  labels: ProjectsTranslator;
}) {
  if (projects.length === 0) {
    return (
      <EmptyState
        className="rounded-lg border bg-card"
        title={labels("index.noMatches")}
        body={labels("index.noMatchesDescription")}
      />
    );
  }

  return (
    <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {projects.map((project) => (
        <ProjectCard key={project.id} project={project} labels={labels} />
      ))}
    </ul>
  );
}
