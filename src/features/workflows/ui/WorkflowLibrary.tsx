"use client";

import { ArrowUpRight, GitBranch, MoreHorizontal, Plus } from "lucide-react";
import Link from "next/link";
import { type MouseEvent, useEffect, useId, useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import type { WorkflowLibraryRow } from "../library";
import { workflowLocation } from "./libraryLocation";
import {
  type LibraryOverlay,
  libraryEmptyState,
  libraryFilterChips,
  libraryHasFilters,
  libraryOverlay,
  libraryVisibleRows,
} from "./libraryView";
import { NewWorkflowDialog, type NewWorkflowMemory } from "./NewWorkflowDialog";
import { useDialogFocus } from "./useDialogFocus";
import { useWorkflowLibraryReads } from "./useWorkflowLibraryReads";
import {
  type LibraryAcknowledgement,
  type LibraryCommandMemory,
  type LibraryOperation,
  WorkflowLifecycleDialog,
} from "./WorkflowLifecycleDialog";
import { WorkflowOwnerFilter } from "./WorkflowOwnerFilter";

type Selection = { operation: LibraryOperation; row: WorkflowLibraryRow };
type Ack = { operation: "archive" | "unarchive"; id: string };

function fallbackTarget(...candidates: (HTMLElement | null)[]): HTMLElement | null {
  return (
    candidates.find(
      (element) =>
        element?.isConnected === true && !element.matches(":disabled,[aria-disabled=true]"),
    ) ?? null
  );
}

export function WorkflowLibrary({
  canCreate,
  initialLocation = "/workflows",
}: {
  canCreate: boolean;
  initialLocation?: string;
}) {
  const t = useAppTranslations("workflows");
  const fmt = useFormatters();
  const reads = useWorkflowLibraryReads(initialLocation, canCreate);
  const {
    input,
    search,
    setSearch,
    previous,
    cursorReset,
    returnTo,
    list,
    data,
    denied,
    createAllowed,
    ownersAllowed,
    invalid,
    readProblem,
    retrying,
    readError,
    confirmedAfterAck,
    reread,
    change,
    next,
    back,
    beginAck,
    owners,
  } = reads;
  const [creating, setCreating] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [creationMemory, setCreationMemory] = useState<NewWorkflowMemory>();
  const [commandMemory, setCommandMemory] = useState<Record<string, LibraryCommandMemory>>({});
  const [ack, setAck] = useState<Ack | null>(null);
  const [overlays, setOverlays] = useState<Record<string, LibraryOverlay>>({});
  const [refreshingAck, setRefreshingAck] = useState(false);
  const id = useId();
  const focus = useDialogFocus();
  const searchInput = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const newWorkflow = useRef<HTMLButtonElement>(null);
  const rowButtons = useRef<Record<string, HTMLButtonElement | null>>({});
  const opening = useRef(false);
  if (denied && (creating || selection !== null)) {
    setCreating(false);
    setSelection(null);
  }
  useEffect(() => {
    if (denied) opening.current = false;
  }, [denied]);
  function clear() {
    reads.clear();
    searchInput.current?.focus();
  }
  function start(event: MouseEvent<HTMLButtonElement>) {
    if (!createAllowed) return;
    focus.remember(event.currentTarget);
    opening.current = true;
    setCreating(true);
  }
  function select(operation: LibraryOperation, row: WorkflowLibraryRow) {
    if (!row.capabilities[operation]) return;
    focus.remember(rowButtons.current[row.id] ?? null);
    opening.current = true;
    setSelection({ operation, row });
  }
  function close() {
    setCreating(false);
    setSelection(null);
    opening.current = false;
  }
  function restoreFocus(event: Event) {
    focus.restore(event, fallbackTarget(searchInput.current, heading.current));
  }
  async function acknowledged(operation: "archive" | "unarchive", row: LibraryAcknowledgement) {
    setOverlays((current) => ({ ...current, [row.id]: libraryOverlay(row) }));
    setAck({ operation, id: row.id });
    beginAck();
    setRefreshingAck(true);
    close();
    try {
      await reread(true);
    } finally {
      setRefreshingAck(false);
    }
  }

  const rows = libraryVisibleRows(data, overlays, input, denied, list.isPlaceholderData);
  const pendingRead = list.isLoading || list.isFetching || list.isPlaceholderData || refreshingAck;
  const confirmed =
    data !== undefined && !denied && !pendingRead && !readError && confirmedAfterAck;
  const empties = libraryEmptyState(data, rows, input, confirmed);
  const filters = libraryHasFilters(input);
  const chips = libraryFilterChips(input, rows, t);

  return (
    <div className="mx-auto max-w-6xl space-y-7">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 ref={heading} tabIndex={-1} className="text-display font-semibold tracking-tight">
              {t("title")}
            </h1>
            <Badge variant="outline">{t("early")}</Badge>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        {createAllowed && (
          <Button ref={newWorkflow} onClick={start}>
            <Plus className="size-4" />
            {t("new")}
          </Button>
        )}
      </header>
      <p className="rounded-lg border border-primary/15 bg-primary/5 px-5 py-4 text-sm leading-6 text-muted-foreground">
        {t("scope")} <span className="block">{t("libraryRunIdentity")}</span>
      </p>
      <fieldset className="space-y-3" disabled={denied}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-2 sm:col-span-2 lg:col-span-1">
            <label htmlFor={`${id}-search`} className="text-sm font-medium">
              {t("librarySearch")}
            </label>
            <Input
              ref={searchInput}
              id={`${id}-search`}
              type="search"
              dir="auto"
              maxLength={200}
              aria-describedby={`${id}-hint`}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                change({ query: event.target.value.trim() });
              }}
            />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">{t("libraryArchive")}</p>
            <Select
              ariaLabel={t("libraryArchive")}
              value={input.archive}
              options={[
                { value: "current", label: t("libraryCurrent") },
                { value: "archived", label: t("libraryArchived") },
              ]}
              onChange={(value) =>
                change({ archive: value === "archived" ? "archived" : "current", status: "all" })
              }
            />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">{t("libraryStatus")}</p>
            <Select
              ariaLabel={t("libraryStatus")}
              disabled={input.archive === "archived"}
              value={input.status}
              options={[
                { value: "all", label: t("libraryAllStatuses") },
                { value: "active", label: t("active") },
                { value: "draft", label: t("draft") },
                { value: "paused", label: t("paused") },
              ]}
              onChange={(value) =>
                change({
                  status:
                    value === "active"
                      ? "active"
                      : value === "draft"
                        ? "draft"
                        : value === "paused"
                          ? "paused"
                          : "all",
                })
              }
            />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">{t("libraryHealth")}</p>
            <Select
              ariaLabel={t("libraryHealth")}
              value={input.health}
              options={[
                { value: "all", label: t("libraryHealthAll") },
                { value: "latest-live-failed", label: t("libraryHealthFailed") },
              ]}
              onChange={(value) =>
                change({ health: value === "latest-live-failed" ? "latest-live-failed" : "all" })
              }
            />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">{t("librarySort")}</p>
            <Select
              ariaLabel={t("librarySort")}
              value={input.sort}
              options={[
                { value: "updated-desc", label: t("librarySortUpdated") },
                { value: "name-asc", label: t("librarySortNameAsc") },
                { value: "name-desc", label: t("librarySortNameDesc") },
              ]}
              onChange={(value) =>
                change({
                  sort:
                    value === "name-asc"
                      ? "name-asc"
                      : value === "name-desc"
                        ? "name-desc"
                        : "updated-desc",
                })
              }
            />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">{t("libraryPageSize")}</p>
            <Select
              ariaLabel={t("libraryPageSize")}
              value={String(input.limit)}
              options={[25, 50, 100, ...(![25, 50, 100].includes(input.limit) ? [input.limit] : [])]
                .sort((a, b) => a - b)
                .map((value) => ({ value: String(value), label: String(value) }))}
              onChange={(value) => {
                const size = Number(value);
                if (Number.isInteger(size) && size >= 1 && size <= 100) change({ limit: size });
              }}
            />
          </div>
        </div>
        {ownersAllowed && (
          <WorkflowOwnerFilter
            key={input.archive}
            value={input.ownerId}
            selectedName={rows.find((row) => row.owner.id === input.ownerId)?.owner.name}
            onChange={(ownerId) => change({ ownerId })}
            query={owners}
          />
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" disabled={!filters} onClick={clear}>
            {t("libraryClearFilters")}
          </Button>
          {chips.length > 0 && (
            <fieldset className="flex flex-wrap gap-2">
              <legend className="sr-only">{t("libraryAppliedFilters")}</legend>
              {chips.map((chip) => (
                <Badge key={chip.id} variant="secondary">
                  <bdi>{chip.label}</bdi>
                </Badge>
              ))}
            </fieldset>
          )}
        </div>
        <p id={`${id}-hint`} className="text-xs leading-5 text-muted-foreground">
          {t("libraryFilterHint")}
        </p>
      </fieldset>
      {ack !== null && (
        <p role="status" className="text-success">
          {t(ack.operation === "archive" ? "archivedSaved" : "unarchivedSaved")}
          {refreshingAck && <span className="ms-2">{t("loading")}</span>}
        </p>
      )}
      {pendingRead && rows.length === 0 && ack === null && <p role="status">{t("loading")}</p>}
      {cursorReset && (
        <p className="text-sm text-muted-foreground">{t("libraryPageChangedHint")}</p>
      )}
      {denied && (
        <p role="alert" className="rounded-lg border p-6">
          {t("denied")}
        </p>
      )}
      {readError && (
        <div role="alert" className="space-y-3 rounded-lg border bg-card p-6">
          <p>
            {ack !== null && readProblem
              ? t("refreshAfterAck")
              : invalid
                ? t("libraryInvalidFilters")
                : t("loadError")}
          </p>
          <Button
            variant="outline"
            disabled={list.isFetching || retrying}
            onClick={() => void reread()}
          >
            {t(ack !== null && readProblem ? "refresh" : "retry")}
          </Button>
        </div>
      )}
      {empties.scope && (
        <div className="flex min-h-80 flex-col items-center justify-center rounded-lg border bg-card p-8 text-center">
          <GitBranch className="mb-5 size-9 text-primary" />
          <h2 className="text-lg font-semibold">
            {t(input.archive === "archived" ? "libraryArchivedEmpty" : "empty")}
          </h2>
          <p className="mb-6 mt-2 text-sm text-muted-foreground">
            {t(input.archive === "archived" ? "libraryArchivedEmptyHint" : "emptyHint")}
          </p>
          {createAllowed && input.archive === "current" && (
            <Button onClick={start}>{t("new")}</Button>
          )}
        </div>
      )}
      {empties.matches && (
        <div role="status" className="rounded-lg border border-dashed bg-card p-8 text-center">
          <h2 className="text-lg font-semibold">{t("libraryNoMatches")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t("libraryNoMatchesHint")}</p>
        </div>
      )}
      {empties.continuation && (
        <div role="status" className="space-y-3 rounded-lg border p-6">
          <h2>{t("libraryPageChanged")}</h2>
          <p>{t("libraryPageChangedHint")}</p>
          <Button variant="outline" onClick={() => change({})}>
            {t("libraryFirst")}
          </Button>
        </div>
      )}
      {rows.length > 0 && (
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="hidden grid-cols-[1fr_180px_180px_40px] gap-5 border-b px-6 py-3 text-xs font-medium text-muted-foreground md:grid">
            <span>{t("name")}</span>
            <span>{t("libraryStatus")}</span>
            <span>{t("updated")}</span>
            <span />
          </div>
          {rows.map((row) => (
            <div
              key={row.id}
              className="flex items-center gap-4 border-b px-4 py-4 last:border-0 md:px-6"
            >
              <Link
                href={workflowLocation(row.id, returnTo)}
                className="flex min-w-0 flex-1 items-center gap-4 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:grid md:grid-cols-[1fr_180px_180px]"
              >
                <div className="flex min-w-0 items-center gap-4">
                  <div className="rounded-lg border bg-muted/40 p-3 text-primary">
                    <GitBranch className="size-5" />
                  </div>
                  <div className="min-w-0">
                    <bdi className="block truncate text-sm font-semibold">{row.name}</bdi>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {t("libraryOwner")}: <bdi>{row.owner.name}</bdi>
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant={row.lifecycle === "active" ? "success" : "secondary"}>
                    {t(row.lifecycle)}
                  </Badge>
                  {row.latestLiveRun !== null && (
                    <Badge
                      variant={row.latestLiveRun.status === "failed" ? "destructive" : "outline"}
                    >
                      {row.latestLiveRun.status === "failed"
                        ? t("libraryHealthFailed")
                        : t(`status.${row.latestLiveRun.status}`)}
                    </Badge>
                  )}
                </div>
                <span className="hidden text-xs text-muted-foreground md:block">
                  {fmt.dateTime(row.updatedAt)}
                </span>
                <ArrowUpRight aria-hidden className="sr-only" />
              </Link>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    ref={(element) => {
                      rowButtons.current[row.id] = element;
                    }}
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t("libraryActions", { name: row.name })}
                  >
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  onCloseAutoFocus={(event) => {
                    if (opening.current) event.preventDefault();
                  }}
                >
                  <DropdownMenuItem asChild>
                    <Link href={workflowLocation(row.id, returnTo, true)}>
                      {t("libraryHistory")}
                    </Link>
                  </DropdownMenuItem>
                  {row.capabilities.duplicate && (
                    <DropdownMenuItem onSelect={() => select("duplicate", row)}>
                      {t("duplicate")}
                    </DropdownMenuItem>
                  )}
                  {row.capabilities.archive && (
                    <DropdownMenuItem onSelect={() => select("archive", row)}>
                      {t("archive")}
                    </DropdownMenuItem>
                  )}
                  {row.capabilities.unarchive && (
                    <DropdownMenuItem onSelect={() => select("unarchive", row)}>
                      {t("unarchive")}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      )}
      {!denied && (data !== undefined || input.cursor !== undefined) && (
        <nav aria-label={t("libraryPageSize")} className="flex flex-wrap justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={previous.length === 0 || pendingRead}
            onClick={back}
          >
            {t("libraryPrevious")}
          </Button>
          {input.cursor !== undefined && !empties.continuation && (
            <Button
              type="button"
              variant="outline"
              disabled={pendingRead}
              onClick={() => change({})}
            >
              {t("libraryFirst")}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={data === undefined || data.nextCursor === null || pendingRead}
            onClick={next}
          >
            {t("libraryNext")}
          </Button>
        </nav>
      )}
      {creating && !denied && (
        <NewWorkflowDialog
          allowed={createAllowed}
          returnTo={returnTo}
          memory={creationMemory}
          onMemory={setCreationMemory}
          onClose={close}
          onCloseAutoFocus={(event) => {
            focus.restore(
              event,
              fallbackTarget(newWorkflow.current, searchInput.current, heading.current),
            );
          }}
          onReview={reread}
        />
      )}
      {selection !== null && !denied && (
        <WorkflowLifecycleDialog
          key={`${selection.operation}-${selection.row.id}`}
          operation={selection.operation}
          row={selection.row}
          returnTo={returnTo}
          memory={commandMemory[`${selection.operation}-${selection.row.id}`]}
          onMemory={(memory) =>
            setCommandMemory((current) => ({
              ...current,
              [`${selection.operation}-${selection.row.id}`]: memory,
            }))
          }
          onClose={close}
          onCloseAutoFocus={restoreFocus}
          onAcknowledged={acknowledged}
          onReview={reread}
        />
      )}
    </div>
  );
}
