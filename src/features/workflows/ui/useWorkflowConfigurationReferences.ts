"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { trpc } from "@/lib/trpc-client";
import type {
  ConfigurationReferenceSelector,
  ConfigurationReferencesInput,
  ConfigurationReferencesPage,
} from "../configurationLookups";
import { findPaletteEntry } from "../paletteCatalog";
import type { WorkflowNode } from "../schemas";
import { libraryReadDenied, libraryRefetchFailed } from "./libraryErrors";
import type { WorkflowCustomReference } from "./WorkflowCustomValueControl";

type Page = Extract<ConfigurationReferencesPage, { state: "page" }>;
type Item = Page["items"][number];
type Status = WorkflowCustomReference["status"];
interface Receipt {
  at: number;
  data: ConfigurationReferencesPage | undefined;
}
interface ReadQuery {
  data: ConfigurationReferencesPage | undefined;
  dataUpdatedAt: number;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
}
interface Read {
  status: Status;
  page?: Page;
  stale: boolean;
}
interface Accepted {
  key: string;
  cursor: string | undefined;
  receipt: Receipt;
  rows: Item[];
}
interface Paging {
  scope: string;
  identity: string;
  search: string;
  cursor: string | undefined;
  accepted: Accepted | null;
}
interface Fence {
  scope: string;
  search: Receipt;
  selected: Receipt;
}
interface Retry {
  key: string;
  pending: boolean;
  search: { before: Receipt; failed: boolean };
  selected: { before: Receipt; failed: boolean } | null;
}

export interface WorkflowConfigurationReferencesInput {
  workflowId?: string;
  type: WorkflowNode["type"];
  selector: ConfigurationReferenceSelector;
  fingerprint?: string;
  selectedId?: string;
  enabled: boolean;
}

export type WorkflowConfigurationReferences = Omit<WorkflowCustomReference, "retry"> & {
  retry: () => Promise<void>;
  selected: Item | undefined;
  unavailable: boolean;
  stale: boolean;
};

const uuid = z.string().uuid();
const fingerprintPattern = /^[a-f0-9]{64}$/;

function validScope(input: WorkflowConfigurationReferencesInput): boolean {
  if (!input.enabled || !uuid.safeParse(input.workflowId).success) return false;
  if (input.fingerprint !== undefined && !fingerprintPattern.test(input.fingerprint)) return false;
  if (input.selector.kind === "custom")
    return (
      input.type === "activity.create" &&
      uuid.safeParse(input.selector.fieldId).success &&
      input.fingerprint !== undefined
    );
  return input.selector.name === "recordId"
    ? input.type === "record.read"
    : input.type === "activity.create";
}

function receipt(query: ReadQuery): Receipt {
  return { at: query.dataUpdatedAt, data: query.data };
}

function sameReceipt(left: Receipt, right: Receipt): boolean {
  return left.at === right.at && left.data === right.data;
}

function sameSelector(
  left: ConfigurationReferenceSelector,
  right: ConfigurationReferenceSelector,
): boolean {
  if (left.kind === "builtin") return right.kind === "builtin" && left.name === right.name;
  return right.kind === "custom" && left.fieldId === right.fieldId;
}

function matchesPage(
  data: ConfigurationReferencesPage | undefined,
  input: ConfigurationReferencesInput,
): data is Page {
  if (data?.state !== "page") return false;
  if (data.workflowId !== input.workflowId || data.type !== input.type || data.mode !== input.mode)
    return false;
  if (findPaletteEntry(data.type, data.version) !== findPaletteEntry(input.type, input.version))
    return false;
  if (!sameSelector(data.field, input.field)) return false;
  if (input.fingerprint !== undefined && data.fingerprint !== input.fingerprint) return false;
  if (input.mode === "search") return data.query === (input.query ?? "").trim();
  return data.query === "" && data.items.every((item) => input.ids.includes(item.id));
}

function readState(
  query: ReadQuery,
  input: ConfigurationReferencesInput,
  enabled: boolean,
  fence: Receipt | undefined,
): Read {
  if (!enabled) return { status: "loading", stale: false };
  if (query.isError)
    return { status: libraryReadDenied(query.error) ? "denied" : "error", stale: false };
  if (query.data?.state === "stale") return { status: "error", stale: true };
  if (query.isLoading || query.isFetching) return { status: "loading", stale: false };
  if (!matchesPage(query.data, input)) return { status: "loading", stale: false };
  if (fence !== undefined && sameReceipt(fence, receipt(query)))
    return { status: "loading", stale: false };
  return { status: "ready", page: query.data, stale: false };
}

function combinedStatus(search: Read, selected: Read, selectedEnabled: boolean): Status {
  const reads = selectedEnabled ? [search, selected] : [search];
  if (reads.some((read) => read.status === "denied")) return "denied";
  if (reads.some((read) => read.status === "error")) return "error";
  if (reads.some((read) => read.status !== "ready")) return "loading";
  return "ready";
}

function currentPaging(paging: Paging, scope: string, identity: string): Paging {
  if (paging.scope === scope) return paging;
  return {
    scope,
    identity,
    search: paging.identity === identity ? paging.search : "",
    cursor: undefined,
    accepted: null,
  };
}

function mergeItems(previous: readonly Item[], next: readonly Item[]): Item[] {
  const rows = new Map(previous.map((item) => [item.id, item]));
  for (const item of next) rows.set(item.id, item);
  return [...rows.values()];
}

function acceptedPage(
  previous: Accepted | null,
  page: Page | undefined,
  key: string,
  cursor: string | undefined,
  current: Receipt,
): Accepted | null {
  if (page === undefined) return previous;
  if (previous?.key === key && sameReceipt(previous.receipt, current)) return previous;
  // While a new cursor loads, an old cache object's matching public fields are
  // insufficient proof that the response belongs to the new page.
  if (previous !== null && previous.cursor !== cursor && sameReceipt(previous.receipt, current))
    return previous;
  const rows =
    cursor === undefined ? [...page.items] : mergeItems(previous?.rows ?? [], page.items);
  return { key, cursor, receipt: current, rows };
}

function freshRetryRead(before: Receipt, current: Receipt, read: Read): boolean {
  return read.status === "ready" && current.at > before.at;
}

function retryStatus(
  state: Retry | null,
  key: string,
  receipts: { search: Receipt; selected: Receipt },
  read: ReturnType<typeof snapshot>,
  fallback: Status,
): Status {
  if (fallback === "denied") return fallback;
  if (state?.key !== key) return fallback;
  if (state.pending) return "loading";
  const searchFresh = freshRetryRead(state.search.before, receipts.search, read.search);
  const selectedFresh =
    state.selected === null ||
    freshRetryRead(state.selected.before, receipts.selected, read.selectedRead);
  if ((!searchFresh && state.search.failed) || (!selectedFresh && state.selected?.failed === true))
    return "error";
  return searchFresh && selectedFresh ? fallback : "loading";
}

async function reread(
  refetch: () => Promise<unknown>,
  before: Receipt,
): Promise<{ before: Receipt; failed: boolean }> {
  try {
    return { before, failed: libraryRefetchFailed(await refetch()) };
  } catch {
    return { before, failed: true };
  }
}

function queryInputs(input: WorkflowConfigurationReferencesInput, paging: Paging) {
  const enabled = validScope(input);
  const selectedEnabled = enabled && uuid.safeParse(input.selectedId).success;
  const common = {
    workflowId: input.workflowId ?? "",
    type: input.type,
    version: 1 as const,
    field: input.selector,
    ...(input.fingerprint === undefined ? {} : { fingerprint: input.fingerprint }),
  };
  const search: ConfigurationReferencesInput = {
    ...common,
    mode: "search",
    query: paging.search.trim(),
    limit: 25,
    ...(paging.cursor === undefined ? {} : { cursor: paging.cursor }),
  };
  const selected: ConfigurationReferencesInput = {
    ...common,
    mode: "selected",
    ids: input.selectedId === undefined ? [] : [input.selectedId],
  };
  return {
    enabled,
    selectedEnabled,
    search,
    selected,
    key: JSON.stringify([search, selectedEnabled ? selected : null]),
  };
}

function changedFence(
  fence: Fence | null,
  scope: string,
  search: Receipt,
  selected: Receipt,
): boolean {
  return (
    fence?.scope !== scope ||
    !sameReceipt(fence.search, search) ||
    !sameReceipt(fence.selected, selected)
  );
}

function snapshot(
  searchQuery: ReadQuery,
  selectedQuery: ReadQuery,
  inputs: ReturnType<typeof queryInputs>,
  fence: Fence | undefined,
) {
  const search = readState(searchQuery, inputs.search, inputs.enabled, fence?.search);
  const selectedRead = readState(
    selectedQuery,
    inputs.selected,
    inputs.selectedEnabled,
    fence?.selected,
  );
  const stale =
    search.stale ||
    selectedRead.stale ||
    (inputs.selectedEnabled &&
      search.page !== undefined &&
      selectedRead.page !== undefined &&
      search.page.fingerprint !== selectedRead.page.fingerprint);
  return {
    search,
    selectedRead,
    stale,
    status: stale
      ? ("error" as const)
      : combinedStatus(search, selectedRead, inputs.selectedEnabled),
  };
}

function selectionState(
  input: WorkflowConfigurationReferencesInput,
  read: ReturnType<typeof snapshot>,
  accepted: Accepted | null,
  key: string,
  cursor: string | undefined,
  retry: Retry | null,
  receipts: { search: Receipt; selected: Receipt },
) {
  const fallback = read.status === "ready" && accepted?.key !== key ? "loading" : read.status;
  const status = retryStatus(retry, key, receipts, read, fallback);
  const selected =
    status === "ready"
      ? read.selectedRead.page?.items.find((item) => item.id === input.selectedId)
      : undefined;
  const rows =
    status === "ready"
      ? mergeItems(accepted?.rows ?? [], selected === undefined ? [] : [selected])
      : [];
  const unavailable =
    input.selectedId !== undefined &&
    (!uuid.safeParse(input.selectedId).success || (status === "ready" && selected === undefined));
  return {
    status,
    selected,
    unavailable,
    options: rows.filter((item) => !unavailable || item.id !== input.selectedId),
    stale: read.stale,
    nextCursor: status === "ready" ? (read.search.page?.nextCursor ?? null) : null,
    loadingMore: cursor !== undefined && status === "loading",
  };
}

export function useWorkflowConfigurationReferences(
  input: WorkflowConfigurationReferencesInput,
): WorkflowConfigurationReferences {
  const identity = JSON.stringify([input.workflowId, input.type, input.selector]);
  const scope = JSON.stringify([identity, input.fingerprint]);
  const [paging, setPaging] = useState<Paging>({
    scope,
    identity,
    search: "",
    cursor: undefined,
    accepted: null,
  });
  const current = currentPaging(paging, scope, identity);
  if (current !== paging) setPaging(current);
  const inputs = queryInputs(input, current);
  const { enabled, selectedEnabled, key } = inputs;
  const options = { refetchOnMount: "always" as const, staleTime: 0, retry: false as const };
  const searchQuery = trpc.workflows.configurationReferences.useQuery(inputs.search, {
    ...options,
    enabled,
  });
  const selectedQuery = trpc.workflows.configurationReferences.useQuery(inputs.selected, {
    ...options,
    enabled: selectedEnabled,
  });
  const [fence, setFence] = useState<Fence | null>(null);
  const [retryState, setRetryState] = useState<Retry | null>(null);
  const activeRetry = useRef<object | null>(null);
  const activeScope = useRef({ key, enabled });
  useEffect(() => {
    activeScope.current = { key, enabled };
    return () => {
      activeRetry.current = null;
    };
  }, [key, enabled]);
  const searchReceipt = receipt(searchQuery);
  const selectedReceipt = receipt(selectedQuery);
  const block = !enabled || searchQuery.isError || (selectedEnabled && selectedQuery.isError);
  if (block && changedFence(fence, scope, searchReceipt, selectedReceipt))
    setFence({ scope, search: searchReceipt, selected: selectedReceipt });
  const read = snapshot(
    searchQuery,
    selectedQuery,
    inputs,
    fence?.scope === scope ? fence : undefined,
  );
  const accepted = acceptedPage(
    current.accepted,
    read.search.page,
    key,
    current.cursor,
    searchReceipt,
  );
  if (accepted !== current.accepted) setPaging({ ...current, accepted });
  const selection = selectionState(input, read, accepted, key, current.cursor, retryState, {
    search: searchReceipt,
    selected: selectedReceipt,
  });

  function onSearch(raw: string) {
    const next = raw.slice(0, 200);
    activeRetry.current = null;
    setRetryState(null);
    if (next.trim() === current.search.trim()) setPaging({ ...current, search: next });
    else setPaging({ ...current, search: next, cursor: undefined, accepted: null });
  }
  function onMore() {
    if (
      selection.status !== "ready" ||
      read.search.page?.nextCursor == null ||
      searchQuery.isFetching
    )
      return;
    activeRetry.current = null;
    setRetryState(null);
    setPaging({ ...current, accepted, cursor: read.search.page.nextCursor });
  }
  async function retry(): Promise<void> {
    if (
      !enabled ||
      activeRetry.current !== null ||
      searchQuery.isFetching ||
      (selectedEnabled && selectedQuery.isFetching)
    )
      return;
    const token = {};
    activeRetry.current = token;
    const pending: Retry = {
      key,
      pending: true,
      search: { before: searchReceipt, failed: false },
      selected: selectedEnabled ? { before: selectedReceipt, failed: false } : null,
    };
    setRetryState(pending);
    let completed = pending;
    try {
      const [search, selected] = await Promise.all([
        reread(() => searchQuery.refetch(), searchReceipt),
        selectedEnabled
          ? reread(() => selectedQuery.refetch(), selectedReceipt)
          : Promise.resolve(null),
      ] as const);
      completed = { key, pending: false, search, selected };
    } finally {
      if (
        activeRetry.current === token &&
        activeScope.current.key === key &&
        activeScope.current.enabled
      ) {
        activeRetry.current = null;
        setRetryState(completed);
      }
    }
  }
  return { ...selection, search: current.search, onSearch, onMore, retry };
}
