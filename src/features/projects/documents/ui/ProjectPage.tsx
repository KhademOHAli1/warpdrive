"use client";

import { Ellipsis, History, LockKeyhole } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useState } from "react";
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
import { trpc } from "@/lib/trpc-client";
import { cn } from "@/lib/utils";
import { readCsrfToken } from "@/utils/csrfCookie";
import type { ProjectResult, ProjectSummary } from "../../contracts";
import { ProjectWriteNotice } from "../../ui/ProjectTitleDialog";
import { projectsTranslator } from "../../ui/projectMessages";
import { useProjectWrites } from "../../ui/projectWrites";
import { useProjectFormatters } from "../../ui/useProjectFormatters";
import {
  restoreProjectDocumentVersionAction,
  saveProjectDocumentAction,
  setProjectDocumentLifecycleAction,
} from "../actions";
import {
  type ProjectDocumentDetail,
  type ProjectDocumentLifecycleAction,
  type ProjectDocumentSummary,
  type ProjectDocumentVersion,
  type ProjectDocumentVersionSummary,
  projectDocumentTitleMaxLength,
} from "../contracts";
import { projectDocumentPeerColor } from "../live/awareness";
import type { ProjectDocumentPeer } from "../live/contracts";
import { useProjectDocumentCollaboration } from "../live/useProjectDocumentCollaboration";
import { ProjectPageEditor } from "./ProjectPageEditor";
import { type PageLabels, pageLabels } from "./pageLabels";

function ProjectPagePeers({
  peers,
  self,
  label,
}: {
  peers: ProjectDocumentPeer[];
  self: number | undefined;
  label: string;
}) {
  const collaborators = peers.filter(({ clientId }) => clientId !== self);
  if (collaborators.length === 0) return null;
  return (
    <ul className="flex flex-wrap items-center gap-1.5" aria-label={label}>
      {collaborators.slice(0, 4).map(({ clientId, name }) => (
        <li key={clientId}>
          <Badge variant="outline" style={{ borderColor: projectDocumentPeerColor(clientId) }}>
            <bdi className="max-w-36 truncate">{name}</bdi>
          </Badge>
        </li>
      ))}
      {collaborators.length > 4 && (
        <li>
          <Badge variant="secondary">+{collaborators.length - 4}</Badge>
        </li>
      )}
    </ul>
  );
}

function ProjectPageMetadata({
  labels,
  document,
  dateTime,
  children,
}: {
  labels: PageLabels;
  document: ProjectDocumentSummary;
  dateTime: (value: string) => string;
  children: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <Badge variant="outline">{labels[document.visibility]}</Badge>
      {document.archivedAt !== null && <Badge variant="secondary">{labels.archived}</Badge>}
      {document.locked && (
        <Badge variant="secondary">
          <LockKeyhole aria-hidden="true" className="size-3" />
          {labels.locked}
        </Badge>
      )}
      <span>
        {labels.author} <bdi>{document.author.name}</bdi>
      </span>
      <time dateTime={document.updatedAt}>{dateTime(document.updatedAt)}</time>
      {children}
    </div>
  );
}

function ProjectPageCollaborationStatus({
  labels,
  status,
  canEdit,
  current,
  discardUnsentChanges,
}: {
  labels: PageLabels;
  status: ReturnType<typeof useProjectDocumentCollaboration>["status"];
  canEdit: boolean;
  current: boolean;
  discardUnsentChanges: () => void;
}) {
  if (!current || (!canEdit && status !== "rejected" && status !== "offline")) return null;
  const messages = {
    connecting: labels.collaborationConnecting,
    current: labels.collaborationCurrent,
    syncing: labels.collaborationSyncing,
    offline: labels.collaborationOffline,
    rejected: labels.collaborationRejected,
    denied: labels.collaborationDenied,
  };
  return (
    <div className="flex min-h-5 flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
      <span role="status">{messages[status]}</span>
      {status === "rejected" && (
        <Button type="button" variant="outline" size="sm" onClick={discardUnsentChanges}>
          {labels.collaborationDiscard}
        </Button>
      )}
    </div>
  );
}

function ProjectPageHistory({
  labels,
  versions,
  current,
  selected,
  url,
  number,
  dateTime,
}: {
  labels: PageLabels;
  versions: ProjectDocumentVersionSummary[];
  current: number;
  selected: number;
  url: string;
  number: (value: number) => string;
  dateTime: (value: string) => string;
}) {
  return (
    <aside className="rounded-lg border bg-card">
      <h2 className="border-b px-3 py-2.5 text-sm font-semibold">{labels.history}</h2>
      <ul className="max-h-96 divide-y overflow-auto">
        {versions.map(({ revision, recordedAt }) => (
          <li key={revision}>
            <Link
              href={revision === current ? url : `${url}?version=${revision}`}
              aria-current={revision === selected ? "page" : undefined}
              className={cn(
                "flex flex-col gap-1 px-3 py-2.5 text-sm hover:bg-accent/40",
                revision === selected && "bg-accent",
              )}
            >
              <span>
                {labels.version} {number(revision)}
              </span>
              <time dateTime={recordedAt} className="text-xs text-muted-foreground">
                {dateTime(recordedAt)}
              </time>
            </Link>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function pagesBackLink(pages: string, document: ProjectDocumentSummary) {
  if (document.archivedAt !== null) return `${pages}?type=archived`;
  if (document.visibility === "private") return `${pages}?type=private`;
  return pages;
}

function editorKey(version: ProjectDocumentVersion | null, revision: number, epoch: number | null) {
  if (version !== null) return `history:${version.revision}`;
  if (epoch === null) return `preview:${revision}`;
  return `live:${epoch}`;
}

function newestVersions(
  versions: ProjectDocumentVersionSummary[],
  remote: ProjectResult<ProjectDocumentDetail> | undefined,
) {
  if (remote?.ok !== true) return versions;
  const stored = remote.value.versions;
  return (stored[0]?.revision ?? -1) > (versions[0]?.revision ?? -1) ? stored : versions;
}

function needsCheckpoint(
  title: string,
  document: ProjectDocumentSummary,
  lastVersion: number | undefined,
) {
  return title.trim() !== "" && (title !== document.title || lastVersion !== document.revision);
}

function ProjectPageActions({
  labels,
  document,
  url,
  viewingVersion,
  canRestore,
  canManage,
  dirty,
  pending,
  showHistory,
  toggleHistory,
  restoreVersion,
  changeLifecycle,
}: {
  labels: PageLabels;
  document: ProjectDocumentSummary;
  url: string;
  viewingVersion: boolean;
  canRestore: boolean;
  canManage: boolean;
  dirty: boolean;
  pending: boolean;
  showHistory: boolean;
  toggleHistory: () => void;
  restoreVersion: () => void;
  changeLifecycle: (action: ProjectDocumentLifecycleAction) => void;
}) {
  if (viewingVersion)
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Link href={url} className={buttonVariants({ size: "sm", variant: "outline" })}>
          {labels.back}
        </Link>
        {canRestore && (
          <ConfirmDialog
            trigger={
              <Button size="sm" disabled={pending}>
                {labels.restoreVersion}
              </Button>
            }
            title={labels.restoreVersion}
            description={labels.restoreDescription}
            confirmLabel={labels.restoreVersion}
            pending={pending}
            onConfirm={restoreVersion}
          />
        )}
      </div>
    );
  const archived = document.archivedAt !== null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" aria-pressed={showHistory} onClick={toggleHistory}>
        <History aria-hidden="true" className="size-4" />
        {labels.history}
      </Button>
      {canManage && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              className="size-8 p-0"
              aria-label={labels.actions}
              disabled={dirty || pending}
            >
              <Ellipsis aria-hidden="true" className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {!archived && (
              <DropdownMenuItem
                onSelect={() => changeLifecycle(document.locked ? "unlock" : "lock")}
              >
                {document.locked ? labels.unlock : labels.lock}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => changeLifecycle(archived ? "restore" : "archive")}>
              {archived ? labels.restore : labels.archive}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

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
  const { dateTime, number } = useProjectFormatters();
  const company = useCompanyMessages();
  const labels = projectsTranslator(locale, numberingSystem);
  const t = pageLabels[locale];
  const { execute, pending, error } = useProjectWrites();
  const [detail, setDetail] = useState(initial);
  const [titleDraft, setTitleDraft] = useState<{ original: string; value: string } | null>(null);
  const [showHistory, setShowHistory] = useState(version !== null);
  const [savedRevision, setSavedRevision] = useState<number | null>(null);
  const collaboration = useProjectDocumentCollaboration(
    project.id,
    initial.document.id,
    version === null,
  );
  const { session, status, hasUnsentChanges } = collaboration;
  const fresh =
    session !== null && session.snapshot.document.revision >= detail.document.revision
      ? session.snapshot
      : null;
  const document = fresh?.document ?? detail.document;
  const canEdit = fresh?.canEdit ?? detail.canEdit;
  const canManage = fresh?.canManage ?? detail.canManage;
  const editable = canEdit && version === null && session?.shared != null;
  const title = titleDraft?.value ?? document.title;
  const titleConflict = titleDraft !== null && titleDraft.original !== document.title;
  const dirty = (editable && title !== document.title) || hasUnsentChanges;
  const pages = `/projects/internal/${project.id}/documents`;
  const url = `${pages}/${document.id}`;
  const pagesIndex = pagesBackLink(pages, document);
  const reference = { projectId: project.id, documentId: document.id, revision: document.revision };
  useDepartureGuard(dirty, company.unsaved);
  const history = trpc.projectDocuments.read.useQuery(
    { projectId: project.id, documentId: document.id },
    {
      enabled: showHistory && version === null && status !== "denied",
      refetchInterval: 5_000,
      gcTime: 0,
    },
  );
  const versions = newestVersions(detail.versions, history.data);
  const canSave =
    editable &&
    status === "current" &&
    !pending &&
    !titleConflict &&
    needsCheckpoint(title, document, versions[0]?.revision);

  function accept(next: ProjectDocumentDetail) {
    setDetail(next);
    setTitleDraft(null);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave) return;
    setSavedRevision(null);
    await execute(
      () =>
        saveProjectDocumentAction(actorId, { ...reference, title: title.trim() }, readCsrfToken()),
      (next) => {
        accept(next);
        setSavedRevision(next.document.revision);
      },
    );
  }

  function changeLifecycle(action: ProjectDocumentLifecycleAction) {
    setSavedRevision(null);
    void execute(
      () => setProjectDocumentLifecycleAction(actorId, { ...reference, action }, readCsrfToken()),
      accept,
    );
  }

  if (status === "denied" && version === null) {
    return (
      <section className="space-y-3">
        <p role="alert">{t.collaborationDenied}</p>
        <Link className={buttonVariants({ size: "sm", variant: "outline" })} href={pages}>
          {t.pages}
        </Link>
      </section>
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
          <ProjectPageActions
            labels={t}
            document={document}
            url={url}
            viewingVersion={version !== null}
            canRestore={canEdit && version?.revision !== document.revision}
            canManage={canManage}
            dirty={dirty}
            pending={pending}
            showHistory={showHistory}
            toggleHistory={() => setShowHistory(!showHistory)}
            restoreVersion={restoreVersion}
            changeLifecycle={changeLifecycle}
          />
        }
      />

      <ProjectPageMetadata labels={t} document={document} dateTime={dateTime}>
        {version === null && session !== null && status !== "offline" && (
          <ProjectPagePeers
            peers={session.snapshot.peers}
            self={session.awareness?.clientID}
            label={t.collaborators}
          />
        )}
      </ProjectPageMetadata>

      <ProjectWriteNotice error={error} labels={labels} />
      <div
        className={cn(
          "grid items-start gap-4",
          showHistory && "lg:grid-cols-[minmax(0,1fr)_17rem]",
        )}
      >
        <form className="min-w-0 space-y-3" onSubmit={(event) => void save(event)}>
          <ProjectPageCollaborationStatus
            labels={t}
            status={status}
            canEdit={canEdit}
            current={version === null}
            discardUnsentChanges={collaboration.discardUnsentChanges}
          />
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
                setSavedRevision(null);
                setTitleDraft({
                  original: titleDraft?.original ?? document.title,
                  value: event.target.value,
                });
              }}
            />
          )}
          {editable && titleConflict && (
            <div className="flex items-center gap-2 text-sm">
              <span role="alert">{t.titleChanged}</span>
              <Button type="button" size="sm" variant="outline" onClick={() => setTitleDraft(null)}>
                {t.useCurrentTitle}
              </Button>
            </div>
          )}
          <ProjectPageEditor
            key={editorKey(
              version,
              document.revision,
              session?.shared == null ? null : session.snapshot.epoch,
            )}
            html={version?.bodyHtml ?? fresh?.previewHtml ?? detail.document.bodyHtml}
            labels={t}
            editable={editable && !pending}
            shared={version === null ? (session?.shared ?? null) : null}
            awareness={version === null ? (session?.awareness ?? null) : null}
          />
          {editable && (
            <div className="flex items-center justify-end gap-2">
              {savedRevision === document.revision && !dirty && (
                <span role="status" className="text-sm text-muted-foreground">
                  {t.saved}
                </span>
              )}
              <Button type="submit" disabled={!canSave}>
                {labels(pending ? "actions.saving" : "actions.save")}
              </Button>
            </div>
          )}
        </form>
        {showHistory && (
          <ProjectPageHistory
            labels={t}
            versions={versions}
            current={document.revision}
            selected={version?.revision ?? document.revision}
            url={url}
            dateTime={dateTime}
            number={number}
          />
        )}
      </div>
    </section>
  );
}
