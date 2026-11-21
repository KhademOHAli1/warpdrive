"use client";

import { Ellipsis, History, LockKeyhole } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PageHeading } from "@/components/shell/PageHeading";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonVariants } from "@/components/ui/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/Input";
import { useCompanyMessages } from "@/features/company-profile/messages";
import { useDepartureGuard } from "@/features/company-profile/ui/useDepartureGuard";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { useFormatters } from "@/lib/useFormatters";
import { cn } from "@/lib/utils";
import { readCsrfToken } from "@/utils/csrfCookie";
import type { ProjectSummary } from "../../contracts";
import { ProjectWriteNotice } from "../../ui/ProjectTitleDialog";
import { projectsTranslator } from "../../ui/projectMessages";
import { useProjectWrites } from "../../ui/projectWrites";
import {
  restoreProjectDocumentVersionAction,
  saveProjectDocumentAction,
  setProjectDocumentLifecycleAction,
} from "../actions";
import {
  type ProjectDocumentDetail,
  type ProjectDocumentVersion,
  projectDocumentBodyMaxLength,
  projectDocumentTitleMaxLength,
} from "../contracts";
import { ProjectPageEditor } from "./ProjectPageEditor";
import { pageLabels } from "./pageLabels";

export function ProjectPage({
  project,
  initial,
  actorId,
  version,
}: {
  project: ProjectSummary;
  initial: ProjectDocumentDetail;
  actorId: string;
  version: ProjectDocumentVersion | null;
}) {
  const router = useRouter();
  const { locale, numberingSystem } = useLocalePreferences();
  const { dateTime, number } = useFormatters();
  const company = useCompanyMessages();
  const labels = projectsTranslator(locale, numberingSystem);
  const t = pageLabels[locale];
  const { execute, pending, error } = useProjectWrites();
  const [detail, setDetail] = useState(initial);
  const [title, setTitle] = useState(initial.document.title);
  const [html, setHtml] = useState(initial.document.bodyHtml);
  const [showHistory, setShowHistory] = useState(version !== null);
  const [saved, setSaved] = useState(false);
  const { document, canEdit, canManage, versions } = detail;
  const editable = canEdit && version === null;
  const dirty = editable && (title !== document.title || html !== document.bodyHtml);
  const tooLarge =
    html.length > projectDocumentBodyMaxLength ||
    (html.length > projectDocumentBodyMaxLength / 3 &&
      new TextEncoder().encode(html).byteLength > projectDocumentBodyMaxLength);
  const pages = `/projects/internal/${project.id}/documents`;
  const url = `${pages}/${document.id}`;
  const pagesIndex =
    document.archivedAt !== null
      ? `${pages}?type=archived`
      : document.visibility === "private"
        ? `${pages}?type=private`
        : pages;
  const reference = { projectId: project.id, documentId: document.id, revision: document.revision };
  useDepartureGuard(dirty, company.unsaved);

  function accept(next: ProjectDocumentDetail) {
    setDetail(next);
    setTitle(next.document.title);
    setHtml(next.document.bodyHtml);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dirty || pending || tooLarge || title.trim() === "") return;
    setSaved(false);
    await execute(
      () =>
        saveProjectDocumentAction(
          actorId,
          { ...reference, title: title.trim(), bodyHtml: html },
          readCsrfToken(),
        ),
      (next) => {
        accept(next);
        setSaved(true);
      },
    );
  }

  function changeLifecycle(action: "archive" | "restore" | "lock" | "unlock") {
    setSaved(false);
    void execute(
      () => setProjectDocumentLifecycleAction(actorId, { ...reference, action }, readCsrfToken()),
      accept,
    );
  }

  function restoreVersion() {
    if (version === null) return;
    void execute(
      () =>
        restoreProjectDocumentVersionAction(
          actorId,
          { ...reference, versionRevision: version.revision },
          readCsrfToken(),
        ),
      () => router.replace(url),
    );
  }

  return (
    <section className={`${BLOCK_CLASS} ph-no-capture`}>
      <PageHeading
        title={version?.title ?? document.title}
        crumbs={[
          { label: labels("index.title"), href: "/projects/internal" },
          { label: project.title, href: `/projects/internal/${project.id}` },
          { label: t.pages, href: pagesIndex },
          { label: version === null ? document.title : `${t.version} ${number(version.revision)}` },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {version !== null ? (
              <>
                <Link href={url} className={buttonVariants({ size: "sm", variant: "outline" })}>
                  {t.back}
                </Link>
                {canEdit && version.revision !== document.revision && (
                  <ConfirmDialog
                    trigger={
                      <Button size="sm" disabled={pending}>
                        {t.restoreVersion}
                      </Button>
                    }
                    title={t.restoreVersion}
                    description={t.restoreDescription}
                    confirmLabel={t.restoreVersion}
                    pending={pending}
                    onConfirm={restoreVersion}
                  />
                )}
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  aria-pressed={showHistory}
                  onClick={() => setShowHistory(!showHistory)}
                >
                  <History aria-hidden="true" className="size-4" />
                  {t.history}
                </Button>
                {canManage && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        className="size-8 p-0"
                        aria-label={t.actions}
                        disabled={dirty || pending}
                      >
                        <Ellipsis aria-hidden="true" className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {document.archivedAt === null && (
                        <DropdownMenuItem
                          onSelect={() => changeLifecycle(document.locked ? "unlock" : "lock")}
                        >
                          {document.locked ? t.unlock : t.lock}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        onSelect={() =>
                          changeLifecycle(document.archivedAt === null ? "archive" : "restore")
                        }
                      >
                        {document.archivedAt === null ? t.archive : t.restore}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </>
            )}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline">{t[document.visibility]}</Badge>
        {document.archivedAt !== null && <Badge variant="secondary">{t.archived}</Badge>}
        {document.locked && (
          <Badge variant="secondary">
            <LockKeyhole aria-hidden="true" className="size-3" />
            {t.locked}
          </Badge>
        )}
        <span>
          {t.author} <bdi>{document.author.name}</bdi>
        </span>
        <time dateTime={document.updatedAt}>{dateTime(document.updatedAt)}</time>
      </div>

      <ProjectWriteNotice error={error} labels={labels} />
      <div
        className={cn(
          "grid items-start gap-4",
          showHistory && "lg:grid-cols-[minmax(0,1fr)_17rem]",
        )}
      >
        <form className="min-w-0 space-y-3" onSubmit={(event) => void save(event)}>
          {editable && (
            <Input
              value={title}
              dir="auto"
              required
              aria-label={t.title}
              className="h-10 text-base font-medium"
              maxLength={projectDocumentTitleMaxLength}
              disabled={pending}
              onChange={(event) => {
                setSaved(false);
                setTitle(event.target.value);
              }}
            />
          )}
          <ProjectPageEditor
            key={version === null ? `current:${document.revision}` : `history:${version.revision}`}
            html={version?.bodyHtml ?? document.bodyHtml}
            labels={t}
            editable={editable && !pending}
            onChange={(value) => {
              setSaved(false);
              setHtml(value);
            }}
          />
          {editable && (
            <div className="flex items-center justify-end gap-2">
              {tooLarge && (
                <span role="status" className="text-sm text-destructive">
                  {t.tooLarge}
                </span>
              )}
              {saved && (
                <span role="status" className="text-sm text-muted-foreground">
                  {t.saved}
                </span>
              )}
              <Button type="submit" disabled={pending || !dirty || tooLarge || title.trim() === ""}>
                {labels(pending ? "actions.saving" : "actions.save")}
              </Button>
            </div>
          )}
        </form>
        {showHistory && (
          <aside className="rounded-lg border bg-card">
            <h2 className="border-b px-3 py-2.5 text-sm font-semibold">{t.history}</h2>
            <ul className="max-h-96 divide-y overflow-auto">
              {versions.map(({ revision, recordedAt }) => {
                const current = revision === (version?.revision ?? document.revision);
                return (
                  <li key={revision}>
                    <Link
                      href={revision === document.revision ? url : `${url}?version=${revision}`}
                      aria-current={current ? "page" : undefined}
                      className={cn(
                        "flex flex-col gap-1 px-3 py-2.5 text-sm hover:bg-accent/40",
                        current && "bg-accent",
                      )}
                    >
                      <span>
                        {t.version} {number(revision)}
                      </span>
                      <time dateTime={recordedAt} className="text-xs text-muted-foreground">
                        {dateTime(recordedAt)}
                      </time>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </aside>
        )}
      </div>
    </section>
  );
}
