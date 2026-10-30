"use client";
import Link from "next/link";
import type { useRowSelection } from "@/components/data-table/useRowSelection";
import { Button } from "@/components/ui/Button";
import { useFormatters } from "@/lib/useFormatters";
import type { InboxThread } from "./emailReads";
import { InboxConversationRow } from "./InboxConversationRow";
import styles from "./inboxWorkspace.module.css";
import { useEmailMessages } from "./useEmailMessages";

interface ResultsProps {
  connected: boolean;
  pending: boolean;
  failed: boolean;
  threads: InboxThread[];
  total: number;
  query: string;
  threadId: string | null;
  narrowed: boolean;
  selection: ReturnType<typeof useRowSelection>;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  refresh: () => void;
  onLoadMore: () => void;
  onClear: () => void;
  onOpen: (id: string) => void;
  onButtonRef: (id: string, node: HTMLButtonElement | null) => void;
}
export function InboxConversationResults(props: ResultsProps) {
  const {
    connected,
    pending,
    failed,
    threads,
    total,
    query,
    refresh,
    hasNextPage,
    isFetchingNextPage,
    onLoadMore,
  } = props;
  const E = useEmailMessages();
  const format = useFormatters();
  return (
    <>
      {failed && (
        <div role="alert" className="border-b px-3 py-3 text-xs">
          <p>{E.workspace.loadError}</p>
          <Button variant="outline" size="sm" onClick={refresh}>
            {E.workspace.retry}
          </Button>
        </div>
      )}
      {connected && !pending && !failed && (
        <p role="status" className="border-b px-3 py-2 text-xs text-muted-foreground tabular-nums">
          {format.number(total)} {E.workspace.matching} · {format.number(threads.length)}{" "}
          {E.workspace.loaded}
          {query !== "" && <span className="mt-1 block">{E.workspace.searchScope}</span>}
        </p>
      )}
      <ul className={styles.rows}>
        <ConversationRows {...props} />

        {hasNextPage && !pending && (
          <li className="p-3">
            <Button
              variant="outline"
              className="w-full"
              disabled={isFetchingNextPage}
              onClick={() => onLoadMore()}
            >
              {isFetchingNextPage ? E.loadingMore : E.loadMore}
            </Button>
          </li>
        )}
      </ul>
    </>
  );
}
function ConversationRows({
  connected,
  pending,
  failed,
  threads,
  narrowed,
  onClear,
  threadId,
  selection,
  onOpen,
  onButtonRef,
}: ResultsProps) {
  const E = useEmailMessages();
  return !connected ? (
    <li className={styles.state}>
      <h2 className="font-semibold">{E.workspace.noMailbox}</h2>
      <p className="text-sm text-muted-foreground">{E.workspace.noMailboxHelp}</p>
      <Link href="/settings/connections" className="text-primary underline">
        {E.workspace.connect}
      </Link>
    </li>
  ) : pending ? (
    <li role="status" aria-label={E._extra.loading}>
      {[1, 2, 3, 4, 5].map((key) => (
        <div key={key} className="h-24 border-b p-4">
          <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
          <div className="mt-3 h-2 w-full animate-pulse rounded bg-muted" />
        </div>
      ))}
    </li>
  ) : threads.length === 0 && !failed ? (
    <li className={styles.state}>
      <h2 className="font-semibold">{narrowed ? E.workspace.noMatches : E.workspace.empty}</h2>
      <p className="text-sm text-muted-foreground">
        {narrowed ? E.workspace.noMatchesHelp : E.workspace.emptyHelp}
      </p>
      {narrowed && (
        <Button variant="outline" onClick={() => onClear()}>
          {E.workspace.clear}
        </Button>
      )}
    </li>
  ) : (
    threads.map((thread) => (
      <InboxConversationRow
        key={thread.id}
        thread={thread}
        active={thread.id === threadId}
        selected={selection.isSelected(thread.id)}
        onSelect={() => selection.toggle(thread.id)}
        onOpen={() => onOpen(thread.id)}
        buttonRef={(node) => {
          onButtonRef(thread.id, node);
        }}
      />
    ))
  );
}
