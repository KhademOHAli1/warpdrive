"use client";

import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc-client";
import type { WorkflowLibraryPage } from "../library";
import {
  libraryReadDenied,
  libraryReadInvalid,
  libraryRefetchFailed,
  libraryRefetchHasData,
} from "./libraryErrors";
import {
  buildLibraryLocation,
  defaultLibraryLocation,
  type LibraryLocationInput,
  parseLibraryLocation,
  sanitizeLibraryReturnTo,
} from "./libraryLocation";
import { useWorkflowOwnerQuery } from "./useWorkflowOwnerQuery";

interface LibraryRead {
  data: WorkflowLibraryPage | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  isPlaceholderData: boolean;
  error: unknown;
  refetch: () => Promise<unknown>;
}

function confirmedPage(list: LibraryRead): boolean {
  return list.data !== undefined && !list.isError && !list.isFetching && !list.isPlaceholderData;
}

function resetInput(input: LibraryLocationInput, removeOwner: boolean): LibraryLocationInput {
  const next = { ...input };
  delete next.cursor;
  if (removeOwner) delete next.ownerId;
  return next;
}

function useLibraryNavigation(initialLocation: string) {
  const initial = parseLibraryLocation(sanitizeLibraryReturnTo(initialLocation));
  const [input, setInput] = useState(initial);
  const [search, setSearch] = useState(initial.query);
  const [previous, setPrevious] = useState<(string | undefined)[]>([]);
  const [cursorReset, setCursorReset] = useState(false);
  const currentKey = JSON.stringify(input);
  const activeKey = useRef(currentKey);
  const returnTo = buildLibraryLocation(input);
  useEffect(() => {
    activeKey.current = currentKey;
  }, [currentKey]);
  useEffect(() => {
    if (window.location.pathname === "/workflows")
      window.history.replaceState(window.history.state, "", returnTo);
  }, [returnTo]);
  useEffect(() => {
    const restore = () => {
      if (window.location.pathname !== "/workflows") return;
      const value = parseLibraryLocation(window.location.search);
      activeKey.current = JSON.stringify(value);
      setInput(value);
      setSearch(value.query);
      setPrevious([]);
      setCursorReset(false);
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  function adopt(next: LibraryLocationInput) {
    activeKey.current = JSON.stringify(next);
    setInput(next);
  }
  function change(patch: Partial<LibraryLocationInput>) {
    const next = resetInput({ ...input, ...patch }, false);
    if (next.ownerId === undefined) delete next.ownerId;
    adopt(next);
    setPrevious([]);
    setCursorReset(false);
  }
  function clear() {
    adopt(defaultLibraryLocation());
    setSearch("");
    setPrevious([]);
    setCursorReset(false);
  }
  function next(token: string) {
    setPrevious((values) => [...values, input.cursor]);
    adopt({ ...input, cursor: token });
  }
  function back() {
    if (previous.length === 0) return;
    const token = previous[previous.length - 1];
    const next = resetInput(input, false);
    if (token !== undefined) next.cursor = token;
    setPrevious((values) => values.slice(0, -1));
    adopt(next);
  }
  function adjust(next: LibraryLocationInput, invalid: boolean) {
    setInput(next);
    setPrevious([]);
    if (invalid) setCursorReset(true);
  }
  function isCurrent(key: string) {
    return activeKey.current === key;
  }
  return {
    input,
    search,
    setSearch,
    previous,
    cursorReset,
    currentKey,
    returnTo,
    change,
    clear,
    next,
    back,
    adjust,
    isCurrent,
  };
}

type Confirmation = { data: WorkflowLibraryPage | undefined; key: string; fetching: boolean };

function confirmationChanged(
  pending: Confirmation | null,
  list: LibraryRead,
  key: string,
): boolean {
  return (
    pending !== null &&
    confirmedPage(list) &&
    (pending.key !== key || pending.fetching || pending.data !== list.data)
  );
}

function useReadRecovery(list: LibraryRead, key: string, isCurrent: (key: string) => boolean) {
  const [readProblem, setReadProblem] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const retryGuard = useRef(false);
  if (confirmationChanged(confirmation, list, key)) setConfirmation(null);
  else if (confirmation !== null && list.isFetching && !confirmation.fetching)
    setConfirmation({ ...confirmation, fetching: true });

  async function reread(force = false): Promise<boolean> {
    if (retryGuard.current || (!force && list.isFetching)) return false;
    retryGuard.current = true;
    setRetrying(true);
    setReadProblem(false);
    try {
      const result = await list.refetch();
      const ok = !libraryRefetchFailed(result);
      if (isCurrent(key)) {
        setReadProblem(!ok);
        if (ok && libraryRefetchHasData(result)) setConfirmation(null);
      }
      return ok && libraryRefetchHasData(result) && isCurrent(key);
    } catch {
      if (isCurrent(key)) setReadProblem(true);
      return false;
    } finally {
      retryGuard.current = false;
      setRetrying(false);
    }
  }
  function beginAck() {
    setConfirmation({ data: list.data, key, fetching: list.isFetching });
  }
  return {
    readProblem,
    retrying,
    reread,
    beginAck,
    clearProblem: () => setReadProblem(false),
    confirmedAfterAck: confirmation === null,
  };
}

function currentCapabilities(list: LibraryRead, denied: boolean, canCreate: boolean) {
  return {
    createAllowed: !denied && (list.data?.capabilities.create ?? canCreate),
    ownersAllowed: !denied && list.data?.capabilities.filterOwners === true,
  };
}

function useLibraryAuthority(list: LibraryRead, input: LibraryLocationInput, canCreate: boolean) {
  const [ownerBlock, setOwnerBlock] = useState<{ page: WorkflowLibraryPage | undefined } | null>(
    null,
  );
  const listDenied = list.isError && libraryReadDenied(list.error);
  const ownersEnabled =
    !listDenied && ownerBlock === null && list.data?.capabilities.filterOwners === true;
  const owners = useWorkflowOwnerQuery(input.archive, ownersEnabled);
  if (owners.denied && ownerBlock === null) setOwnerBlock({ page: list.data });
  else if (ownerBlock !== null && confirmedPage(list) && list.data !== ownerBlock.page)
    setOwnerBlock(null);
  useEffect(() => {
    // The current-scope owners endpoint revoked access. Revalidate the external
    // list query, without moving owner-response state through a child effect.
    if (ownerBlock !== null) void list.refetch().catch(() => undefined);
  }, [ownerBlock, list.refetch]);
  const denied = listDenied || owners.denied || ownerBlock !== null;
  return { owners, denied, ...currentCapabilities(list, denied, canCreate) };
}

export function useWorkflowLibraryReads(initialLocation: string, canCreate: boolean) {
  const navigation = useLibraryNavigation(initialLocation);
  const list = trpc.workflows.list.useQuery(navigation.input, { placeholderData: (old) => old });
  const authority = useLibraryAuthority(list, navigation.input, canCreate);
  const recovery = useReadRecovery(list, navigation.currentKey, navigation.isCurrent);
  const invalid = list.isError && libraryReadInvalid(list.error);
  const removeOwner =
    authority.owners.denied ||
    (list.data !== undefined &&
      !list.data.capabilities.filterOwners &&
      navigation.input.ownerId !== undefined);
  if (removeOwner || (invalid && navigation.input.cursor !== undefined)) {
    navigation.adjust(resetInput(navigation.input, removeOwner), invalid);
  }
  const readError = !authority.denied && (list.isError || recovery.readProblem);
  function change(patch: Partial<LibraryLocationInput>) {
    navigation.change(patch);
    recovery.clearProblem();
  }
  function clear() {
    navigation.clear();
    recovery.clearProblem();
  }
  function next() {
    if (list.isFetching || list.data?.nextCursor === null || list.data?.nextCursor === undefined)
      return;
    navigation.next(list.data.nextCursor);
    recovery.clearProblem();
  }
  function back() {
    if (!list.isFetching) {
      navigation.back();
      recovery.clearProblem();
    }
  }
  return {
    ...navigation,
    ...authority,
    ...recovery,
    list,
    data: list.data,
    invalid,
    readError,
    change,
    clear,
    next,
    back,
  };
}
