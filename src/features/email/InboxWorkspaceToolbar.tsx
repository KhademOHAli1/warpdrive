"use client";
import { Archive, Filter, MailPlus, RefreshCw, Search, X } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/Popover";
import { Select } from "@/components/ui/Select";
import { InboxAttributeFilters } from "./InboxAttributeFilters";
import { useInboxMailbox } from "./InboxMailboxContext";
import { FOLDER_KEYS, parseFolder } from "./inboxFolders";
import { INBOX_VIEWS, type InboxLocation } from "./inboxLocation";
import styles from "./inboxWorkspace.module.css";
import { NO_ATTRIBUTE_FILTER } from "./threadAttributeFilter";
import { useEmailMessages } from "./useEmailMessages";

export type InboxNavigate = (next: InboxLocation, replace?: boolean) => void;
export function InboxWorkspaceHeader({
  location,
  onNavigate,
}: {
  location: InboxLocation;
  onNavigate: InboxNavigate;
}) {
  const E = useEmailMessages();
  const connected = useInboxMailbox();
  return (
    <header className={styles.header}>
      <h1 className="me-auto text-lg font-semibold">{E._folders[location.folder]}</h1>
      <div className={styles.folderPicker}>
        <Select
          ariaLabel={E._extra.mail_folders}
          value={location.folder}
          options={FOLDER_KEYS.map((key) => ({ value: key, label: E._folders[key] }))}
          onChange={(folder) =>
            onNavigate({
              ...location,
              folder: parseFolder(folder),
              threadId: null,
              query: "",
              view: "all",
            })
          }
        />
      </div>
      <search className={styles.search} aria-label={E.searchLabel}>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute start-3 top-3 size-4 text-muted-foreground"
        />
        <Input
          type="search"
          maxLength={200}
          aria-label={E.searchLabel}
          placeholder={E.searchPlaceholder}
          value={location.query}
          className="h-10 bg-muted/30 ps-9 pe-9"
          onChange={(event) => onNavigate({ ...location, query: event.target.value }, true)}
        />
        {location.query !== "" && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={E.workspace.clear}
            className="absolute end-1 top-1 size-8"
            onClick={() => onNavigate({ ...location, query: "" }, true)}
          >
            <X className="size-4" />
          </Button>
        )}
      </search>
      {connected ? (
        <Link
          href="/inbox/compose"
          className="inline-flex h-10 items-center gap-2 rounded-md bg-action px-3 text-sm font-medium text-action-foreground"
        >
          <MailPlus aria-hidden="true" className="size-4" />
          {E.composeTitle}
        </Link>
      ) : (
        <Button disabled>
          <MailPlus aria-hidden="true" className="size-4" />
          {E.composeTitle}
        </Button>
      )}
    </header>
  );
}

export function InboxWorkspaceToolbar({
  location,
  onNavigate,
  selected,
  allSelected,
  onSelectAll,
  onArchive,
  onMarkRead,
  onClearSelection,
  busy,
  onRefresh,
}: {
  location: InboxLocation;
  onNavigate: InboxNavigate;
  selected: number;
  allSelected: boolean;
  onSelectAll: () => void;
  onArchive: () => void;
  onMarkRead: () => void;
  onClearSelection: () => void;
  busy: boolean;
  onRefresh: () => void;
}) {
  const E = useEmailMessages();
  return (
    <div className={styles.toolbar}>
      <Checkbox
        label={E._extra.select_all_threads}
        checked={allSelected}
        onCheckedChange={onSelectAll}
      />
      {selected > 0 ? (
        <div
          className="flex min-w-0 flex-1 items-center gap-1"
          role="toolbar"
          aria-label={E.workspace.selection}
        >
          <span className="min-w-0 flex-1 text-xs tabular-nums">
            {E.workspace.selectedLoaded(selected)}
          </span>
          {location.folder !== "sent" && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={location.folder === "archive" ? E.workspace.restore : E.workspace.archive}
              disabled={busy}
              onClick={onArchive}
            >
              <Archive aria-hidden="true" className="size-4" />
            </Button>
          )}
          <Button variant="ghost" size="sm" disabled={busy} onClick={onMarkRead}>
            {E.workspace.markRead}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={E.workspace.clear}
            onClick={onClearSelection}
          >
            <X aria-hidden="true" className="size-4" />
          </Button>
        </div>
      ) : (
        <>
          <nav
            className="flex min-w-0 flex-1 flex-wrap gap-0.5"
            aria-label={E._extra.inbox_filters}
          >
            {INBOX_VIEWS.map((view) => (
              <button
                key={view}
                type="button"
                aria-pressed={location.view === view}
                onClick={() => onNavigate({ ...location, view })}
                className={`rounded-md px-2 py-1.5 text-xs ${location.view === view ? "bg-accent font-semibold text-accent-foreground" : "text-muted-foreground hover:bg-accent/50"}`}
              >
                {E.workspace[view]}
              </button>
            ))}
          </nav>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={E.workspace.filters}>
                <Filter aria-hidden="true" className="size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-auto max-w-[calc(100vw-2rem)] p-4">
              <h2 className="mb-3 text-sm font-semibold">{E.workspace.filters}</h2>
              <div className={styles.filterPanel}>
                <Select
                  ariaLabel={E._extra.inbox_filters}
                  value={location.filter}
                  options={[
                    { value: "all", label: E.filterAll },
                    { value: "unmatched", label: E.filterUnmatched },
                    { value: "needs_linking", label: E.filterNeedsLinking },
                  ]}
                  onChange={(filter) =>
                    onNavigate({
                      ...location,
                      filter: filter === "unmatched" || filter === "needs_linking" ? filter : "all",
                    })
                  }
                />
                <InboxAttributeFilters
                  onClear={() =>
                    onNavigate({ ...location, attributes: NO_ATTRIBUTE_FILTER, filter: "all" })
                  }
                  value={location.attributes}
                  onChange={(attributes) => onNavigate({ ...location, attributes })}
                  quickFilter={location.filter}
                  onQuickFilterChange={(filter) => onNavigate({ ...location, filter })}
                />
              </div>
            </PopoverContent>
          </Popover>
          <Button variant="ghost" size="icon" aria-label={E.workspace.refresh} onClick={onRefresh}>
            <RefreshCw aria-hidden="true" className="size-4" />
          </Button>
        </>
      )}
    </div>
  );
}
