"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageHeading } from "@/components/shell/PageHeading";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonVariants } from "@/components/ui/Button";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { cn } from "@/lib/utils";
import { instantCivilDate } from "@/lib/zonedDateTime";
import type { ProjectSummary } from "../../contracts";
import { ProjectWorkspaceNav } from "../../ui/ProjectWorkspaceNav";
import { type ProjectsTranslator, projectsTranslator } from "../../ui/projectMessages";
import { useProjectFormatters } from "../../ui/useProjectFormatters";
import {
  type ProjectIntakeFilter,
  type ProjectIntakeRequest,
  type ProjectIntakeWorkspace,
  projectIntakeStatuses,
} from "../contracts";
import { type IntakeMessages, intakeMessages } from "../messages";
import { type IntakeDecision, IntakeDecisionDialog } from "./IntakeDecisionDialog";
import { IntakeEditorDialog } from "./IntakeEditorDialog";

function intakeLink(path: string, filter: ProjectIntakeFilter, page = 1, requestId?: string) {
  const params = new URLSearchParams();
  if (filter !== "pending") params.set("status", filter);
  if (page > 1) params.set("page", String(page));
  if (requestId !== undefined) params.set("request", requestId);
  const query = params.toString();
  return query === "" ? path : `${path}?${query}`;
}

function IntakeRequestDetails({
  request,
  projectPath,
  labels,
  projects,
  canReview,
  onEdit,
  onDecision,
  timeZone,
}: {
  request: ProjectIntakeRequest;
  projectPath: string;
  labels: IntakeMessages;
  projects: ProjectsTranslator;
  canReview: boolean;
  onEdit: () => void;
  onDecision: (action: IntakeDecision) => void;
  timeZone?: string;
}) {
  const { dateOnly, dateTime } = useProjectFormatters();
  const unresolved = request.status === "pending" || request.status === "snoozed";
  return (
    <article className="min-w-0 space-y-5 rounded-lg border bg-card p-4 sm:p-5">
      <header className="space-y-2">
        <Badge variant="outline">{labels[request.status]}</Badge>
        <h2 className="wrap-anywhere text-xl font-semibold" dir="auto">
          {request.title}
        </h2>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span>
            {labels.submittedBy} <bdi>{request.requester.name}</bdi>
          </span>
          <time dateTime={request.createdAt}>{dateTime(request.createdAt)}</time>
          <span>
            {labels.priority} <bdi>{projects(`priority.${request.priority}`)}</bdi>
          </span>
        </div>
      </header>
      {request.description !== "" && (
        <p className="wrap-anywhere whitespace-pre-wrap text-sm" dir="auto">
          {request.description}
        </p>
      )}
      {request.snoozedUntil !== null && (
        <p className="text-sm text-muted-foreground">
          {labels.snoozeUntil}{" "}
          <time dateTime={request.snoozedUntil}>
            {dateOnly(instantCivilDate(request.snoozedUntil, timeZone))}
          </time>
        </p>
      )}
      {request.workItemId !== null && (
        <Link
          className={buttonVariants({ variant: "outline", size: "sm" })}
          href={`${projectPath}?item=${encodeURIComponent(request.workItemId)}`}
        >
          {labels.workItem}
        </Link>
      )}
      {unresolved && (
        <div className="flex flex-wrap gap-2 border-t pt-3">
          {canReview && (
            <>
              <Button size="sm" onClick={() => onDecision("accept")}>
                {labels.accept}
              </Button>
              <Button size="sm" variant="outline" onClick={() => onDecision("decline")}>
                {labels.decline}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onDecision(request.status === "snoozed" ? "unsnooze" : "snooze")}
              >
                {request.status === "snoozed" ? labels.unsnooze : labels.snooze}
              </Button>
              <Button size="sm" variant="outline" onClick={() => onDecision("duplicate")}>
                {labels.markDuplicate}
              </Button>
            </>
          )}
          {request.canEdit && (
            <>
              <Button size="sm" variant="outline" onClick={onEdit}>
                {labels.edit}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onDecision("withdraw")}>
                {labels.withdraw}
              </Button>
            </>
          )}
        </div>
      )}
    </article>
  );
}

function IntakeQueue({
  path,
  filter,
  page,
  queue,
  labels,
}: {
  path: string;
  filter: ProjectIntakeFilter;
  page: number;
  queue: ProjectIntakeWorkspace;
  labels: IntakeMessages;
}) {
  const { dateTime } = useProjectFormatters();
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border bg-card">
      {queue.requests.length === 0 && (
        <p className="p-4 text-sm text-muted-foreground">{labels.empty}</p>
      )}
      <ul className="divide-y">
        {queue.requests.map((request) => (
          <li key={request.id}>
            <Link
              href={intakeLink(path, filter, page, request.id)}
              aria-current={request.id === queue.selected?.id ? "page" : undefined}
              className="flex flex-col gap-1 px-4 py-3 text-sm hover:bg-muted aria-[current=page]:bg-accent"
            >
              <span className="truncate font-medium" dir="auto">
                {request.title}
              </span>
              <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <bdi className="max-w-40 truncate">{request.requester.name}</bdi>
                <time dateTime={request.createdAt}>{dateTime(request.createdAt)}</time>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {(queue.nextPage !== null || page > 1) && (
        <div className="flex justify-between gap-2 border-t p-2">
          {page > 1 && (
            <Link
              className={buttonVariants({ size: "sm", variant: "ghost" })}
              href={intakeLink(path, filter, page - 1)}
            >
              {labels.previous}
            </Link>
          )}
          {queue.nextPage !== null && (
            <Link
              className={buttonVariants({ size: "sm", variant: "ghost" })}
              href={intakeLink(path, filter, queue.nextPage)}
            >
              {labels.next}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

export function ProjectIntakePage({
  actorId,
  project,
  queue,
  filter,
  page,
  restrictedGuest,
}: {
  actorId: string;
  project: ProjectSummary;
  queue: ProjectIntakeWorkspace;
  filter: ProjectIntakeFilter;
  page: number;
  restrictedGuest?: boolean;
}) {
  const router = useRouter();
  const { locale, numberingSystem } = useLocalePreferences();
  const labels = intakeMessages[locale];
  const projects = projectsTranslator(locale, numberingSystem);
  const [editor, setEditor] = useState<"new" | "edit" | null>(null);
  const [decision, setDecision] = useState<IntakeDecision | null>(null);
  const projectPath = `/projects/internal/${project.id}`;
  const path = `${projectPath}/intake`;

  function refresh(nextFilter: ProjectIntakeFilter, requestId?: string) {
    const next = intakeLink(path, nextFilter, 1, requestId);
    router.replace(next);
    router.refresh();
  }

  return (
    <section className={cn("min-w-0", BLOCK_CLASS, "ph-no-capture")}>
      <PageHeading
        title={labels.title}
        crumbs={[
          { label: projects("index.title"), href: "/projects/internal" },
          { label: project.title, href: projectPath },
          { label: labels.title },
        ]}
        actions={
          queue.canSubmit && (
            <Button onClick={() => setEditor("new")}>
              <Plus aria-hidden="true" className="size-4" />
              {labels.submit}
            </Button>
          )
        }
      />
      <ProjectWorkspaceNav
        projectId={project.id}
        active="intake"
        intakeEnabled={queue.enabled}
        canManageSettings={queue.canManageSettings}
        restrictedGuest={restrictedGuest}
      />
      {queue.enabled ? (
        <>
          <nav aria-label={labels.title} className="mb-4 flex flex-wrap gap-1">
            {([...projectIntakeStatuses, "all"] as const).map((view) => (
              <Link
                key={view}
                href={intakeLink(path, view)}
                aria-current={filter === view ? "page" : undefined}
                className={cn(
                  buttonVariants({ size: "sm", variant: "ghost" }),
                  "aria-[current=page]:bg-accent aria-[current=page]:font-medium",
                )}
              >
                {labels[view]}
              </Link>
            ))}
          </nav>
          <div className="grid items-start gap-4 md:grid-cols-[minmax(13rem,20rem)_minmax(0,1fr)]">
            <IntakeQueue path={path} filter={filter} page={page} queue={queue} labels={labels} />
            {queue.selected !== null && (
              <IntakeRequestDetails
                request={queue.selected}
                projectPath={projectPath}
                labels={labels}
                projects={projects}
                canReview={queue.canReview}
                onEdit={() => setEditor("edit")}
                onDecision={setDecision}
                timeZone={project.timeZone}
              />
            )}
          </div>
        </>
      ) : (
        <div className="rounded-lg border bg-card p-4 text-sm">
          <p>{labels.unavailable}</p>
          {queue.canManageSettings && (
            <Link
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-3")}
              href={`${projectPath}/settings/intake`}
            >
              {labels.enable}
            </Link>
          )}
        </div>
      )}
      {editor !== null && (
        <IntakeEditorDialog
          actorId={actorId}
          projectId={project.id}
          labels={labels}
          projects={projects}
          existing={editor === "edit" ? queue.selected : null}
          close={() => setEditor(null)}
          onSaved={(id) => {
            refresh(editor === "new" ? "pending" : filter, id);
            setEditor(null);
          }}
        />
      )}
      {decision !== null && queue.selected !== null && (
        <IntakeDecisionDialog
          action={decision}
          labels={labels}
          projects={projects}
          actorId={actorId}
          projectId={project.id}
          request={queue.selected}
          states={queue.states}
          close={() => setDecision(null)}
          onSaved={(nextFilter, id) => {
            refresh(nextFilter, id);
            setDecision(null);
          }}
        />
      )}
    </section>
  );
}
