"use client";

/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Adapts the create-and-open flow from Plane Community v1.5.0
 * apps/web/app/(all)/[workspaceSlug]/(projects)/projects/(detail)/[projectId]/pages/(list)/header.tsx
 * and the list flow from apps/web/components/pages/list/root.tsx.
 */

import { FileText, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { PageHeading } from "@/components/shell/PageHeading";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { useFormatters } from "@/lib/useFormatters";
import { cn } from "@/lib/utils";
import { readCsrfToken } from "@/utils/csrfCookie";
import type { ProjectSummary } from "../../contracts";
import { ProjectWriteNotice } from "../../ui/ProjectTitleDialog";
import { ProjectWorkspaceNav } from "../../ui/ProjectWorkspaceNav";
import { projectsTranslator } from "../../ui/projectMessages";
import { useProjectWrites } from "../../ui/projectWrites";
import { createProjectDocumentAction } from "../actions";
import type { ProjectDocumentsIndex } from "../contracts";
import { pageLabels } from "./pageLabels";
import { type PageType, pageTypes } from "./planePagesNavigation";

export function ProjectPagesList({
  actorId,
  project,
  index,
  pageType,
}: {
  actorId: string;
  project: ProjectSummary;
  index: ProjectDocumentsIndex;
  pageType: PageType;
}) {
  const router = useRouter();
  const { locale, numberingSystem } = useLocalePreferences();
  const t = pageLabels[locale];
  const projectLabels = projectsTranslator(locale, numberingSystem);
  const date = useFormatters().dateTime;
  const { execute, pending, error } = useProjectWrites();
  const [search, setSearch] = useState("");
  const createIntent = useRef<{ id: string; visibility: "project" | "private" } | null>(null);
  const root = `/projects/internal/${project.id}/documents`;
  const query = search.trim().toLocaleLowerCase(locale);
  const pages = index.documents.filter(
    ({ archivedAt, title, visibility }) =>
      (pageType === "archived"
        ? archivedAt !== null
        : archivedAt === null && visibility === pageType) &&
      title.toLocaleLowerCase(locale).includes(query),
  );

  async function handleCreatePage() {
    const visibility = pageType === "private" ? "private" : "project";
    if (createIntent.current?.visibility !== visibility) {
      createIntent.current = { id: crypto.randomUUID(), visibility };
    }
    const { id } = createIntent.current;
    await execute(
      () =>
        createProjectDocumentAction(
          actorId,
          { projectId: project.id, id, title: t.untitled, visibility },
          readCsrfToken(),
        ),
      ({ document }) => router.push(`${root}/${document.id}`),
    );
  }

  return (
    <section className={`${BLOCK_CLASS} ph-no-capture`}>
      <PageHeading
        title={t.pages}
        crumbs={[
          { label: projectLabels("index.title"), href: "/projects/internal" },
          { label: project.title, href: `/projects/internal/${project.id}` },
          { label: t.pages },
        ]}
        actions={
          index.canCreate && pageType !== "archived" ? (
            <Button onClick={() => void handleCreatePage()} disabled={pending}>
              <Plus aria-hidden="true" className="size-4" />
              {t.add}
            </Button>
          ) : null
        }
      />
      <ProjectWorkspaceNav projectId={project.id} active="pages" />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <nav aria-label={t.pages} className="inline-flex flex-wrap rounded-md border bg-card p-0.5">
          {pageTypes.map((type) => (
            <Link
              key={type}
              href={type === "project" ? root : `${root}?type=${type}`}
              aria-current={pageType === type ? "page" : undefined}
              className={cn(
                "rounded-sm px-3 py-1.5 text-sm transition-colors",
                pageType === type
                  ? "bg-accent font-medium text-foreground"
                  : "text-muted-foreground hover:bg-accent/50",
              )}
            >
              {t[type]}
            </Link>
          ))}
        </nav>
        <div className="relative w-full sm:w-60">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute start-2.5 top-2 size-4 text-muted-foreground"
          />
          <Input
            type="search"
            className="ps-8"
            aria-label={t.search}
            placeholder={t.search}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>
      <ProjectWriteNotice error={error} labels={projectLabels} />
      {pages.length === 0 ? (
        <p role="status" className="rounded-lg border bg-card p-5 text-sm text-muted-foreground">
          {t.empty}
        </p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border bg-card">
          {pages.map(({ id, title, author, updatedAt }) => (
            <li key={id}>
              <Link
                href={`${root}/${id}`}
                className="grid min-w-0 gap-1 px-4 py-3 outline-none hover:bg-accent/40 focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[minmax(0,1fr)_minmax(8rem,max-content)] sm:items-center"
              >
                <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                  <FileText aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                  <bdi className="truncate">{title}</bdi>
                </span>
                <span className="text-xs text-muted-foreground">
                  <bdi>{author.name}</bdi> · <time dateTime={updatedAt}>{date(updatedAt)}</time>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
