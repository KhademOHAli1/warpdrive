"use client";
import { MoreHorizontal, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { WorkflowV2LibraryEntry } from "@/features/blocks/contracts";
import { useSharedBlocksMessages } from "@/features/blocks/sharedBlocksMessages";
import {
  archiveWorkflowAction,
  duplicateWorkflowAction,
  unarchiveWorkflowAction,
} from "@/features/workflows/actions";
import {
  buildLibraryLocation,
  parseLibraryLocation,
  workflowLocation,
} from "@/features/workflows/ui/libraryLocation";
import { useFormatters } from "@/lib/useFormatters";
import { readCsrfToken } from "@/utils/csrfCookie";
import {
  archiveWorkflowV2Action,
  createWorkflowV2Action,
  duplicateWorkflowV2Action,
  listWorkflowAllEnginesAction,
  unarchiveWorkflowV2Action,
} from "../actions";

interface Page {
  rows: WorkflowV2LibraryEntry[];
  nextCursor: string | null;
  total: number;
}
type LibraryOperation = "archive" | "restore" | "duplicate";
async function changeLibraryRow(
  row: WorkflowV2LibraryEntry,
  operation: LibraryOperation,
  copyName: string,
  token: string | null,
) {
  if (row.engineVersion === 2) {
    if (operation === "duplicate")
      return duplicateWorkflowV2Action({ id: row.id, name: copyName }, token);
    const action = operation === "archive" ? archiveWorkflowV2Action : unarchiveWorkflowV2Action;
    return action({ id: row.id, expectedRevision: row.revision }, token);
  }
  const input = { id: row.id, revision: row.revision };
  if (operation === "duplicate")
    return duplicateWorkflowAction({ ...input, name: copyName }, token);
  const action = operation === "archive" ? archiveWorkflowAction : unarchiveWorkflowAction;
  return action(input, token);
}
export function UnifiedWorkflowLibrary({
  canCreate,
  initialLocation = "/workflows",
}: {
  canCreate: boolean;
  initialLocation?: string;
}) {
  const L = useSharedBlocksMessages();
  const format = useFormatters();
  const router = useRouter();
  const location = parseLibraryLocation(initialLocation);
  const [query, setQuery] = useState(location.query);
  const [archive, setArchive] = useState<"active" | "archived" | "all">(
    location.archive === "archived" ? "archived" : "active",
  );
  const [status, setStatus] = useState<"all" | "active" | "paused" | "draft">(location.status);
  const returnTo = buildLibraryLocation({
    query,
    archive: archive === "archived" ? "archived" : "current",
    status,
    health: "all",
    sort: "updated-desc",
    limit: 25,
  });
  const [cursor, setCursor] = useState<string>();
  const [previous, setPrevious] = useState<(string | undefined)[]>([]);
  const [page, setPage] = useState<Page | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [unknownCreate, setUnknownCreate] = useState(false);
  const [pending, setPending] = useState(false);
  const [selection, setSelection] = useState<WorkflowV2LibraryEntry | null>(null);
  const lock = useRef(false);
  const generation = useRef(0);
  const lastRefresh = useRef(0);
  useEffect(() => {
    const request = ++generation.current;
    const delay = reload === lastRefresh.current ? 180 : 0;
    lastRefresh.current = reload;
    const timer = setTimeout(() => {
      void listWorkflowAllEnginesAction({ query, archive, status, limit: 25, cursor })
        .then((result) => {
          if (request !== generation.current) return;
          if (result.ok) {
            setPage(result.value);
            setError(null);
          } else setError(L.failed);
        })
        .catch(() => {
          if (request === generation.current) setError(L.failed);
        })
        .finally(() => {
          if (request === generation.current) setLoading(false);
        });
    }, delay);
    return () => {
      clearTimeout(timer);
      generation.current += 1;
    };
  }, [query, archive, status, cursor, reload, L.failed]);
  function refresh() {
    setLoading(true);
    setReload((value) => value + 1);
  }
  function filter(change: () => void) {
    setLoading(true);
    change();
    setCursor(undefined);
    setPrevious([]);
  }
  async function create() {
    if (lock.current || !canCreate || unknownCreate || createdId !== null || name.trim() === "")
      return;
    lock.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await createWorkflowV2Action({ name }, readCsrfToken());
      if (result.ok) {
        setCreatedId(result.value.id);
        router.push(`/workflows/${result.value.id}`);
      } else setError(result.error.id.endsWith("CONFLICT") ? L.conflict : L.failed);
    } catch {
      setUnknownCreate(true);
      setError(L.creationUnknown);
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  async function change(
    row: WorkflowV2LibraryEntry,
    operation: "archive" | "restore" | "duplicate",
  ) {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await changeLibraryRow(
        row,
        operation,
        `${row.name} · ${L.duplicate}`.slice(0, 120),
        readCsrfToken(),
      );
      if (!result.ok) {
        setError(L.failed);
        return;
      }
      if (operation === "duplicate") router.push(workflowLocation(result.value.id, returnTo));
      setSelection(null);
      refresh();
    } catch {
      setError(L.failed);
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{L.workflows}</h1>
        <div className="ms-auto flex flex-wrap items-center gap-4">
          <Link href="/workflows/requests" className="text-xs text-link">
            {L.requests}
          </Link>
          <Link
            href="/workflows?engine=legacy"
            className="text-xs text-muted-foreground hover:text-link"
          >
            {L.legacyFilters}
          </Link>
          {canCreate && (
            <Button
              size="sm"
              onClick={() => {
                setName("");
                setCreatedId(null);
                setUnknownCreate(false);
                setCreating(true);
              }}
            >
              <Plus className="size-3.5" aria-hidden />
              {L.new}
            </Button>
          )}
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label={L.searchWorkflows}
          placeholder={L.searchWorkflows}
          value={query}
          maxLength={200}
          onChange={(event) => filter(() => setQuery(event.target.value))}
          className="h-9 max-w-72 text-xs"
        />
        <div className="w-36">
          <Select
            ariaLabel={L.status}
            value={status}
            options={["all", "active", "paused", "draft"].map((value) => ({
              value,
              label: L[value as "all" | "active" | "paused" | "draft"],
            }))}
            onChange={(value) => filter(() => setStatus(value as typeof status))}
            triggerClassName="h-9 text-xs"
          />
        </div>
        <div className="w-36">
          <Select
            ariaLabel={L.archive}
            value={archive}
            options={[
              { value: "active", label: L.current },
              { value: "archived", label: L.archived },
              { value: "all", label: L.all },
            ]}
            onChange={(value) => filter(() => setArchive(value as typeof archive))}
            triggerClassName="h-9 text-xs"
          />
        </div>
        <Button variant="ghost" size="sm" disabled={loading} onClick={refresh}>
          {L.refresh}
        </Button>
        {page !== null && (
          <span className="ms-auto text-xs text-muted-foreground">{format.number(page.total)}</span>
        )}
      </div>
      {error !== null && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {loading && (
        <p role="status" className="text-xs text-muted-foreground">
          {L.working}
        </p>
      )}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-start text-xs">
          <thead className="border-b bg-muted/20 text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-start font-medium">{L.name}</th>
              <th className="px-4 py-3 text-start font-medium">{L.status}</th>
              <th className="px-4 py-3 text-start font-medium">{L.version}</th>
              <th className="px-4 py-3 text-start font-medium">{L.updated}</th>
              <th className="w-12 px-3 py-3">
                <span className="sr-only">{L.configure}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {page?.rows.map((row) => (
              <tr key={`${row.engineVersion}:${row.id}`} className="hover:bg-muted/20">
                <td className="px-4 py-3">
                  <Link
                    href={workflowLocation(row.id, returnTo)}
                    className="font-medium hover:text-link"
                    dir="auto"
                  >
                    {row.name}
                  </Link>
                  <span className="ms-2 text-[10px] text-muted-foreground">
                    {row.engineVersion === 1 ? L.legacy : L.sharedBlocks}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {row.archivedAt !== null
                    ? L.archived
                    : row.active
                      ? L.active
                      : row.publishedNumber === null
                        ? L.draft
                        : L.paused}
                </td>
                <td className="px-4 py-3 tabular-nums text-muted-foreground">
                  {row.publishedNumber === null ? "—" : format.number(row.publishedNumber)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                  {format.dateTime(row.updatedAt)}
                </td>
                <td className="px-3 py-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="size-8 p-0"
                        disabled={loading || pending || error !== null}
                        aria-label={`${L.configure}: ${row.name}`}
                      >
                        <MoreHorizontal className="size-4" aria-hidden />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() => {
                          void change(row, "duplicate");
                        }}
                      >
                        {L.duplicate}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() =>
                          row.archivedAt === null ? setSelection(row) : void change(row, "restore")
                        }
                      >
                        {row.archivedAt === null ? L.archive : L.restore}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && error === null && page?.rows.length === 0 && (
          <p className="px-4 py-10 text-center text-xs text-muted-foreground">
            {query === "" && status === "all" && archive === "active" ? L.noWorkflows : L.noMatches}
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={loading || previous.length === 0}
          onClick={() => {
            setLoading(true);
            setCursor(previous.at(-1));
            setPrevious(previous.slice(0, -1));
          }}
        >
          {L.previous}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={loading || page?.nextCursor == null || error !== null}
          onClick={() => {
            if (page?.nextCursor != null) {
              setPrevious([...previous, cursor]);
              setLoading(true);
              setCursor(page.nextCursor);
            }
          }}
        >
          {L.nextPage}
        </Button>
      </div>
      <ConfirmDialog
        open={selection !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setSelection(null);
        }}
        title={L.archiveTitle}
        description={L.archiveHint}
        confirmLabel={L.archive}
        cancelLabel={L.cancel}
        pending={pending}
        destructive
        onConfirm={() => {
          if (selection !== null) void change(selection, "archive");
        }}
      />
      {creating && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !pending) setCreating(false);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{L.new}</DialogTitle>
              <DialogDescription>{L.createHint}</DialogDescription>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void create();
              }}
            >
              <Input
                aria-label={L.name}
                autoFocus
                value={name}
                required
                maxLength={120}
                disabled={pending || unknownCreate || createdId !== null}
                onChange={(event) => setName(event.target.value)}
              />
              {error !== null && (
                <p role="alert" className="text-xs text-destructive">
                  {error}
                </p>
              )}
              {createdId !== null && (
                <Link href={`/workflows/${createdId}`} className="text-xs text-link">
                  {L.open}
                </Link>
              )}
              {unknownCreate && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setCreating(false);
                    setQuery(name);
                    refresh();
                  }}
                >
                  {L.reviewLibrary}
                </Button>
              )}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() => setCreating(false)}
                >
                  {L.cancel}
                </Button>
                <Button
                  type="submit"
                  disabled={pending || unknownCreate || createdId !== null || name.trim() === ""}
                >
                  {pending ? L.working : L.create}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
