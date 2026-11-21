"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";
import { intakeMessages } from "../intake/messages";
import { ProjectWriteNotice } from "../ui/ProjectTitleDialog";
import { projectsTranslator } from "../ui/projectMessages";
import { useProjectWrites } from "../ui/projectWrites";
import { publicationCsrfToken } from "./clientCsrf";
import { publicationMessages } from "./messages";
import { PublicIntakeForm } from "./PublicIntakeForm";

type Viewer = { anchor: string; actorId: string };

export function PublicIntakePortal({
  anchor,
  actorId,
  acceptsRequests,
}: Viewer & { acceptsRequests: boolean }) {
  const [showMine, setShowMine] = useState(!acceptsRequests);
  const { locale } = useLocalePreferences();
  const labels = publicationMessages[locale];
  const utils = trpc.useUtils();
  const mine = showMine || !acceptsRequests;
  return (
    <section className="max-w-xl space-y-3">
      {acceptsRequests && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={mine ? "ghost" : "outline"}
            aria-pressed={!mine}
            onClick={() => setShowMine(false)}
          >
            {labels.newRequest}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mine ? "outline" : "ghost"}
            aria-pressed={mine}
            onClick={() => setShowMine(true)}
          >
            {labels.myRequests}
          </Button>
        </div>
      )}
      {mine ? (
        <PublishedIntakeRequests anchor={anchor} actorId={actorId} />
      ) : (
        <PublicIntakeForm
          anchor={anchor}
          actorId={actorId}
          onSaved={() =>
            void utils.internalProjects.publication.mine.invalidate({
              anchor,
              expectedActorId: actorId,
            })
          }
        />
      )}
    </section>
  );
}

function PublishedIntakeRequests({ anchor, actorId }: Viewer) {
  const [page, setPage] = useState(1);
  const [requestId, setRequestId] = useState<string | null>(null);
  const { locale } = useLocalePreferences();
  const labels = publicationMessages[locale];
  const intake = intakeMessages[locale];
  const key = { anchor, expectedActorId: actorId };
  const query = trpc.internalProjects.publication.mine.useQuery({ ...key, page }, { gcTime: 0 });
  const utils = trpc.useUtils();

  function closeDetail(refresh = false) {
    setRequestId(null);
    if (refresh) {
      setPage(1);
      void utils.internalProjects.publication.mine.invalidate(key);
    }
  }

  if (requestId !== null)
    return (
      <PublishedIntakeRequestDetail
        key={requestId}
        anchor={anchor}
        actorId={actorId}
        requestId={requestId}
        close={closeDetail}
      />
    );

  const result = query.data;
  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <h2 className="text-base font-medium">{labels.myRequests}</h2>
      {query.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          {intake.loading}
        </p>
      ) : result?.ok !== true ? (
        <p role="alert" className="text-sm text-destructive">
          {labels.requestsUnavailable}
        </p>
      ) : (
        <>
          {result.value.requests.length === 0 && (
            <p className="text-sm text-muted-foreground">{labels.noRequests}</p>
          )}
          <ul className="divide-y">
            {result.value.requests.map((row) => (
              <li
                key={row.id}
                className="flex min-w-0 flex-wrap items-center justify-between gap-2 py-2"
              >
                <Button type="button" variant="ghost" onClick={() => setRequestId(row.id)}>
                  <bdi>{row.title}</bdi>
                </Button>
                <Badge variant="outline">{intake[row.status]}</Badge>
              </li>
            ))}
          </ul>
          {(page > 1 || result.value.nextPage !== null) && (
            <div className="flex gap-2">
              {page > 1 && (
                <Button type="button" variant="outline" onClick={() => setPage(page - 1)}>
                  {labels.prev}
                </Button>
              )}
              {result.value.nextPage !== null && (
                <Button type="button" variant="outline" onClick={() => setPage(page + 1)}>
                  {labels.next}
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PublishedIntakeRequestDetail({
  anchor,
  actorId,
  requestId,
  close,
}: Viewer & {
  requestId: string;
  close: (refresh?: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const { locale, numberingSystem } = useLocalePreferences();
  const labels = publicationMessages[locale];
  const intake = intakeMessages[locale];
  const projects = projectsTranslator(locale, numberingSystem);
  const key = { anchor, requestId, expectedActorId: actorId };
  const found = trpc.internalProjects.publication.request.useQuery(key, { gcTime: 0 });
  const withdraw = trpc.internalProjects.publication.withdraw.useMutation({ gcTime: 0 });
  const { pending, error, execute } = useProjectWrites();
  const utils = trpc.useUtils();
  const request = found.data?.ok === true ? found.data.value : null;

  function remove(revision: number) {
    void execute(
      async () =>
        withdraw.mutateAsync({ ...key, revision, csrfToken: await publicationCsrfToken() }),
      () => close(true),
    );
  }

  function edited() {
    setEditing(false);
    void utils.internalProjects.publication.request.invalidate(key);
    void utils.internalProjects.publication.mine.invalidate({ anchor, expectedActorId: actorId });
  }

  if (request?.canEdit === true && editing)
    return (
      <PublicIntakeForm
        key={request.revision}
        actorId={actorId}
        anchor={anchor}
        request={request}
        onSaved={edited}
        cancel={() => setEditing(false)}
      />
    );

  return (
    <article className="space-y-3 rounded-lg border bg-card p-4">
      <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => close()}>
        {labels.backToRequests}
      </Button>
      {found.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          {intake.loading}
        </p>
      ) : request === null ? (
        <p role="alert" className="text-sm text-destructive">
          {labels.requestsUnavailable}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="wrap-anywhere text-base font-medium">
              <bdi>{request.title}</bdi>
            </h2>
            <Badge variant="outline">{intake[request.status]}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {labels.priority} {projects(`priority.${request.priority}`)}
          </p>
          {request.description !== "" && (
            <p className="wrap-anywhere whitespace-pre-wrap text-sm" dir="auto">
              {request.description}
            </p>
          )}
          <ProjectWriteNotice error={error} labels={projects} />
          {request.canEdit &&
            (confirm ? (
              <div className="space-y-2 rounded-md border p-3">
                <p className="text-sm">{intake.withdrawDescription}</p>
                <span className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending}
                    onClick={() => setConfirm(false)}
                  >
                    {intake.cancel}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={pending}
                    onClick={() => remove(request.revision)}
                  >
                    {pending ? intake.working : intake.withdraw}
                  </Button>
                </span>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={() => setEditing(true)}>
                  {intake.edit}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setConfirm(true)}>
                  {intake.withdraw}
                </Button>
              </div>
            ))}
        </>
      )}
    </article>
  );
}
