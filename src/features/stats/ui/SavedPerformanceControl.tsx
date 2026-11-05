import { Bookmark } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/Collapsible";
import { Input } from "@/components/ui/Input";
import { useLocalePreferencePending, useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { type RouterOutputs, trpc } from "@/lib/trpc-client";
import { useFormatters } from "@/lib/useFormatters";
import type { OwnerScope } from "@/types/stats";
import { readCsrfToken } from "@/utils/csrfCookie";
import { toToken } from "../ownerScopeToken";
import type { SavedPerformanceDefinition } from "../savedPerformanceReports";
import type { StatsMessages } from "../statsMessages";
import { useStatsMessages } from "../useStatsMessages";
import { Panel } from "./Panel";
import { Scoreboard } from "./Scoreboard";

type Routes = RouterOutputs["stats"]["savedPerformance"];
type Listed = Extract<Routes["list"], { state: "listed" }>;
type Scope = Omit<SavedPerformanceDefinition, "version">;
type Mode = "review" | "run";
type Opened = { id: string; mode: Mode };
type RunResult = RouterOutputs["stats"]["savedPerformanceRerun"];
type Notice =
  | "saved"
  | "deleted"
  | "saveFailed"
  | "deleteFailed"
  | "scopeUnavailable"
  | "reportLimit"
  | "invalidSave";

interface Labels {
  pipelineOptions: readonly { value: string; label: string }[];
  ownerUsers: readonly { id: string; name: string }[];
  ownerTeams: readonly { id: string; name: string }[];
}

interface Props extends Labels {
  scope: Scope;
  canSave: boolean;
}

const READ_OPTIONS = {
  staleTime: 0,
  gcTime: 0,
  refetchOnMount: "always",
  refetchOnWindowFocus: "always",
  refetchOnReconnect: "always",
  retry: false,
  trpc: { abortOnUnmount: true },
} as const;

function reading(query: {
  isFetchedAfterMount: boolean;
  isFetching: boolean;
  isPaused: boolean;
  isPlaceholderData: boolean;
}): boolean {
  return (
    !query.isFetchedAfterMount || query.isFetching || query.isPaused || query.isPlaceholderData
  );
}

function ownerLabel(scope: OwnerScope, labels: Labels, S: StatsMessages): string {
  switch (scope.kind) {
    case "me":
      return S.ownerMe;
    case "all":
      return S.ownerAll;
    case "user":
      return (
        labels.ownerUsers.find(({ id }) => id === scope.userId)?.name ??
        S.savedPerformance.labelUnavailable
      );
    case "team":
      return (
        labels.ownerTeams.find(({ id }) => id === scope.teamId)?.name ??
        S.savedPerformance.labelUnavailable
      );
  }
}

function ScopeReview({
  definition,
  labels,
}: {
  definition: SavedPerformanceDefinition;
  labels: Labels;
}) {
  const S = useStatsMessages();
  const format = useFormatters();
  const pipeline =
    definition.pipelineId === null
      ? S.allPipelines
      : (labels.pipelineOptions.find(({ value }) => value === definition.pipelineId)?.label ??
        S.savedPerformance.labelUnavailable);
  return (
    <dl className="grid grid-cols-2 gap-4 rounded-lg bg-muted/30 p-3 text-sm lg:grid-cols-4">
      <div className="min-w-0">
        <dt className="text-muted-foreground">{S.savedPerformance.fixedPeriod}</dt>
        <dd className="mt-1">
          <bdi>{format.dateOnly(definition.from)}</bdi> {S.rangeSeparator}{" "}
          <bdi>{format.dateOnly(definition.to)}</bdi>
        </dd>
      </div>
      <div className="min-w-0">
        <dt className="text-muted-foreground">{S.pipelineLabel}</dt>
        <dd className="mt-1 break-words">
          <bdi>{pipeline}</bdi>
        </dd>
      </div>
      <div className="min-w-0">
        <dt className="text-muted-foreground">{S.ownerScopeLabel}</dt>
        <dd className="mt-1 break-words">
          <bdi>{ownerLabel(definition.ownerScope, labels, S)}</bdi>
        </dd>
      </div>
      <div className="min-w-0">
        <dt className="text-muted-foreground">{S.currencyLabel}</dt>
        <dd className="mt-1">
          <bdi>{definition.currency}</bdi>
        </dd>
      </div>
    </dl>
  );
}

function reviewFailure(
  reason: Extract<Routes["load"] | RunResult, { state: "unavailable" }>["reason"],
  fallback: "reviewUnavailable" | "runUnavailable",
): "scopeUnavailable" | "unsupported" | "invalidDefinition" | typeof fallback {
  if (reason === "scope-unavailable") return "scopeUnavailable";
  if (reason === "unsupported-version") return "unsupported";
  if (reason === "invalid-definition") return "invalidDefinition";
  return fallback;
}

function SavedScopeReview({ id, labels }: { id: string; labels: Labels }) {
  const S = useStatsMessages();
  const query = trpc.stats.savedPerformance.load.useQuery({ id }, READ_OPTIONS);
  if (reading(query))
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {S.loading}
      </p>
    );
  const result = query.isError ? undefined : query.data;
  if (result?.state === "loaded")
    return <ScopeReview definition={result.definition} labels={labels} />;
  const key =
    result === undefined ? "reviewUnavailable" : reviewFailure(result.reason, "reviewUnavailable");
  return (
    <p role="alert" className="text-sm text-muted-foreground">
      {S.savedPerformance[key]}
    </p>
  );
}

function SavedScopeRun({ id, labels }: { id: string; labels: Labels }) {
  const S = useStatsMessages();
  const pending = useLocalePreferencePending();
  const query = trpc.stats.savedPerformanceRerun.useQuery(
    { id },
    { ...READ_OPTIONS, enabled: !pending },
  );
  if (pending || reading(query)) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {S.loading}
      </p>
    );
  }
  const result = query.isError ? undefined : query.data;
  if (result === undefined || result.state === "unavailable") {
    const key =
      result === undefined ? "runUnavailable" : reviewFailure(result.reason, "runUnavailable");
    return (
      <p role="alert" className="text-sm text-muted-foreground">
        {S.savedPerformance[key]}
      </p>
    );
  }
  const { dashboard, definition, report } = result;
  if (
    report.id !== id ||
    dashboard.currency !== definition.currency ||
    toToken(dashboard.effectiveOwnerScope) !== toToken(definition.ownerScope)
  ) {
    return (
      <p role="alert" className="text-sm text-muted-foreground">
        {S.savedPerformance.scopeUnavailable}
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">{S.savedPerformance.runResult}</p>
      <ScopeReview definition={definition} labels={labels} />
      <p className="text-sm text-muted-foreground">
        {S.recordsTimeZone} <bdi>{dashboard.timeZone}</bdi>
      </p>
      <Scoreboard
        embedded
        deals={dashboard.dealPerformance}
        won={dashboard.wonDealStats}
        activities={dashboard.activities}
        winRate={dashboard.winRate}
        currency={dashboard.currency}
      />
    </div>
  );
}

function SavedDefinitions({
  list,
  labels,
  busy,
  opened,
  onOpen,
  onDelete,
}: {
  list: Listed;
  labels: Labels;
  busy: boolean;
  opened: Opened | null;
  onOpen: (id: string, mode: Mode) => void;
  onDelete: (id: string) => void;
}) {
  const S = useStatsMessages();
  const copy = S.savedPerformance;
  const { timeZone } = useLocalePreferences();
  if (list.reports.length === 0)
    return <p className="text-sm text-muted-foreground">{copy.empty}</p>;
  return (
    <div className="space-y-3">
      {list.truncated && (
        <p role="status" className="text-sm text-muted-foreground">
          {copy.truncated}
        </p>
      )}
      <ul className="divide-y rounded-lg border">
        {list.reports.map((report) => {
          const supported = report.definitionState === "version-1";
          const mode = supported && opened?.id === report.id ? opened.mode : null;
          return (
            <li key={report.id} className="space-y-3 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-words text-sm font-medium">
                    <bdi>{report.name}</bdi>
                  </p>
                  {!supported && (
                    <p className="text-xs text-muted-foreground">{copy.unsupported}</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {supported && (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        aria-label={S._extra.savedPerformanceReviewNamed(report.name)}
                        aria-expanded={mode === "review"}
                        disabled={busy}
                        onClick={() => onOpen(report.id, "review")}
                      >
                        {copy.review}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        aria-label={S._extra.savedPerformanceRunNamed(report.name)}
                        aria-expanded={mode === "run"}
                        disabled={busy}
                        onClick={() => onOpen(report.id, "run")}
                      >
                        {copy.run}
                      </Button>
                    </>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={S._extra.savedPerformanceDeleteNamed(report.name)}
                    disabled={busy}
                    onClick={() => onDelete(report.id)}
                  >
                    {copy.delete}
                  </Button>
                </div>
              </div>
              {mode === "review" && (
                <SavedScopeReview key={report.id} id={report.id} labels={labels} />
              )}
              {mode === "run" && (
                <SavedScopeRun
                  key={JSON.stringify([report.id, timeZone])}
                  id={report.id}
                  labels={labels}
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function saveFailure(
  reason: Extract<Routes["create"], { state: "unavailable" }>["reason"],
): Notice {
  if (reason === "scope-unavailable") return "scopeUnavailable";
  if (reason === "invalid-input") return "invalidSave";
  if (reason === "report-limit") return "reportLimit";
  return "saveFailed";
}

function SavedPerformancePanel({ scope, canSave, ...labels }: Props) {
  const S = useStatsMessages();
  const copy = S.savedPerformance;
  const nameId = useId();
  const [name, setName] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const list = trpc.stats.savedPerformance.list.useQuery(undefined, READ_OPTIONS);
  const create = trpc.stats.savedPerformance.create.useMutation({ gcTime: 0 });
  const remove = trpc.stats.savedPerformance.remove.useMutation({ gcTime: 0 });
  const listPending = reading(list);
  const listed =
    !listPending && !list.isError && list.data?.state === "listed" ? list.data : undefined;
  const busy = create.isPending || remove.isPending;
  const saveDisabled = !canSave || listed === undefined || busy || name.trim() === "";

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saveDisabled) return;
    setNotice(null);
    const { from, to, currency, pipelineId, ownerScope } = scope;
    try {
      const result = await create.mutateAsync({
        name: name.trim(),
        definition: { version: 1, from, to, currency, pipelineId, ownerScope },
        csrfToken: readCsrfToken(),
      });
      if (result.state !== "created") {
        setNotice(saveFailure(result.reason));
        return;
      }
      setName("");
      setNotice("saved");
      void list.refetch();
    } catch {
      setNotice("saveFailed");
    }
  }

  async function deleteDefinition(id: string) {
    setNotice(null);
    try {
      const result = await remove.mutateAsync({ id, csrfToken: readCsrfToken() });
      if (result.state !== "removed") {
        setNotice("deleteFailed");
        return;
      }
      setOpened((current) => (current?.id === id ? null : current));
      setNotice("deleted");
      void list.refetch();
    } catch {
      setNotice("deleteFailed");
    }
  }

  return (
    <Panel title={copy.title} isEmpty={false} emptyText="">
      <div className="space-y-4">
        <p className="max-w-prose text-pretty text-sm text-muted-foreground">{copy.definition}</p>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            void save(event);
          }}
        >
          <div className="min-w-0 flex-1 space-y-1 sm:max-w-80">
            <label htmlFor={nameId} className="text-sm font-medium">
              {copy.name}
            </label>
            <Input
              id={nameId}
              value={name}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <Button type="submit" variant="outline" disabled={saveDisabled}>
            {copy.save}
          </Button>
        </form>
        {notice !== null && (
          <p
            role={notice === "saved" || notice === "deleted" ? "status" : "alert"}
            className="text-sm"
          >
            {copy[notice]}
          </p>
        )}
        {listPending ? (
          <p role="status" className="text-sm text-muted-foreground">
            {S.loading}
          </p>
        ) : listed === undefined ? (
          <div className="space-y-2">
            <p role="alert" className="text-sm text-muted-foreground">
              {copy.listUnavailable}
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void list.refetch();
              }}
            >
              {S.retry}
            </Button>
          </div>
        ) : (
          <SavedDefinitions
            list={listed}
            labels={labels}
            busy={busy}
            opened={opened}
            onOpen={(id, mode) =>
              setOpened((current) =>
                current?.id === id && current.mode === mode ? null : { id, mode },
              )
            }
            onDelete={setPendingDelete}
          />
        )}
      </div>
      {pendingDelete !== null && (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setPendingDelete(null);
          }}
          title={copy.deleteTitle}
          description={copy.deleteDescription}
          confirmLabel={copy.deleteConfirm}
          destructive
          pending={busy || listed === undefined}
          onConfirm={() => {
            void deleteDefinition(pendingDelete);
          }}
        />
      )}
    </Panel>
  );
}

export function SavedPerformanceControl(props: Props) {
  const { savedPerformance: copy } = useStatsMessages();
  return (
    <Collapsible className="space-y-3">
      <CollapsibleTrigger asChild>
        <Button type="button" variant="outline">
          <Bookmark aria-hidden="true" className="size-4" />
          {copy.title}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <SavedPerformancePanel {...props} />
      </CollapsibleContent>
    </Collapsible>
  );
}
