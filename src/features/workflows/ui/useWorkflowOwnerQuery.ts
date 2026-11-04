"use client";

import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc-client";
import type { WorkflowOwnersInput, WorkflowOwnersPage } from "../library";
import { libraryReadDenied, libraryRefetchFailed } from "./libraryErrors";

type Owners = WorkflowOwnersPage["items"];
type AcceptedOwners = {
  data: WorkflowOwnersPage | undefined;
  cursor: string | undefined;
  rows: Owners;
};

function acceptOwners(
  previous: AcceptedOwners,
  data: WorkflowOwnersPage,
  cursor: string | undefined,
): AcceptedOwners {
  const rows =
    cursor === undefined
      ? data.items
      : [
          ...previous.rows,
          ...data.items.filter((owner) => !previous.rows.some((old) => old.id === owner.id)),
        ];
  return { data, cursor, rows };
}

function ownerReadState(
  query: {
    data: WorkflowOwnersPage | undefined;
    isLoading: boolean;
    isFetching: boolean;
    isError: boolean;
    error: unknown;
  },
  enabled: boolean,
) {
  return {
    denied: enabled && query.isError && libraryReadDenied(query.error),
    isLoading: enabled && query.isLoading,
    isFetching: enabled && query.isFetching,
    isError: enabled && query.isError,
    data: enabled ? query.data : undefined,
  };
}

export function useWorkflowOwnerQuery(archive: "current" | "archived", enabled: boolean) {
  const [scope, setScope] = useState(archive);
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState<string | undefined>();
  const [accepted, setAccepted] = useState<AcceptedOwners>({
    data: undefined,
    cursor: undefined,
    rows: [],
  });
  const [retryState, setRetryState] = useState<{
    key: string;
    pending: boolean;
    error: boolean;
  } | null>(null);
  const activeRetry = useRef<object | null>(null);
  const input: WorkflowOwnersInput = {
    archive,
    query: search.trim(),
    limit: 25,
    ...(cursor === undefined ? {} : { cursor }),
  };
  const query = trpc.workflows.owners.useQuery(input, { enabled });
  const read = ownerReadState(query, enabled);
  const { denied } = read;
  const key = JSON.stringify(input);
  const activeScope = useRef({ key, enabled });
  const retrying = retryState?.key === key && retryState.pending;
  const retryError = retryState?.key === key && retryState.error;
  useEffect(() => {
    activeScope.current = { key, enabled };
    return () => {
      activeRetry.current = null;
    };
  }, [key, enabled]);

  // These are adjustments to this component's own state before React commits its
  // children, not a child notifying its parent during render or an effect cascade.
  if (scope !== archive) {
    setScope(archive);
    setSearch("");
    setCursor(undefined);
    setAccepted({ data: undefined, cursor: undefined, rows: [] });
    setRetryState(null);
  } else if (!enabled || denied) {
    if (accepted.data !== undefined) setAccepted({ data: undefined, cursor: undefined, rows: [] });
    if (cursor !== undefined) setCursor(undefined);
    if (retryState !== null) setRetryState(null);
  } else if (
    query.data !== undefined &&
    (query.data !== accepted.data || cursor !== accepted.cursor)
  ) {
    setAccepted(acceptOwners(accepted, query.data, cursor));
  }

  function changeSearch(next: string) {
    setSearch(next);
    if (next.trim() === search.trim()) return;
    setCursor(undefined);
    setAccepted({ data: undefined, cursor: undefined, rows: [] });
    activeRetry.current = null;
    setRetryState(null);
  }
  async function retry() {
    if (activeRetry.current !== null || query.isFetching || !enabled) return;
    const token = {};
    activeRetry.current = token;
    setRetryState({ key, pending: true, error: false });
    let failed = false;
    try {
      failed = libraryRefetchFailed(await query.refetch());
    } catch {
      failed = true;
    } finally {
      if (
        activeRetry.current === token &&
        activeScope.current.enabled &&
        activeScope.current.key === key
      ) {
        activeRetry.current = null;
        setRetryState({ key, pending: false, error: failed });
      }
    }
  }
  function more() {
    activeRetry.current = null;
    setRetryState(null);
    setCursor(query.data?.nextCursor ?? undefined);
  }

  return {
    ...read,
    search,
    changeSearch,
    rows: accepted.rows,
    denied,
    retrying,
    retryError,
    retry,
    more,
  };
}

export type WorkflowOwnerQuery = ReturnType<typeof useWorkflowOwnerQuery>;
