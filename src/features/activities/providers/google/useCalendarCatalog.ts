"use client";
import { useState } from "react";
import { ERROR_IDS } from "@/constants/errorIds";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import {
  discoverGoogleCalendarsAction,
  setGoogleCalendarSelectionAction,
} from "./calendarCatalogActions";
import type {
  GoogleCalendarCatalog,
  GoogleCalendarCatalogEntry,
  GoogleCalendarSelection,
} from "./catalogContracts";
import type { useCalendarConnection } from "./useCalendarConnection";

type CatalogError = "refreshFailed" | "selectionFailed" | "conflict" | "loadFailed";
export function useCalendarCatalog(
  accountId: string,
  connection: ReturnType<typeof useCalendarConnection>,
) {
  const query = trpc.calendars.googleCatalog.useQuery({ accountId }, { staleTime: 0 });
  const [published, setPublished] = useState<GoogleCalendarCatalog | null>(null);
  const [receipts, setReceipts] = useState<Record<string, GoogleCalendarSelection>>({});
  const [error, setError] = useState<CatalogError | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [saved, setSaved] = useState(false);
  const data =
    published !== null && (query.data === undefined || published.revision > query.data.revision)
      ? published
      : query.data;
  const rows = (data?.calendars ?? []).map((row) => {
    const receipt = receipts[row.id];
    return receipt !== undefined && receipt.version > (row.selection?.version ?? 0)
      ? { ...row, selection: receipt }
      : row;
  });
  async function refreshSaved(failure: CatalogError): Promise<void> {
    try {
      const result = await query.refetch();
      if (result.isError || result.data === undefined) {
        setBlocked(true);
        setError(failure);
        return;
      }
      setPublished(result.data);
      setBlocked(result.data.status !== "ready");
      setError(result.data.status === "error" ? "refreshFailed" : null);
    } catch {
      setBlocked(true);
      setError(failure);
    }
  }
  function discover(): void {
    connection.runCatalog(accountId, async () => {
      setError(null);
      setSaved(false);
      setBlocked(true);
      try {
        const result = await discoverGoogleCalendarsAction({ accountId }, readCsrfToken());
        if (!result.ok) {
          const conflict = result.error.id === ERROR_IDS.CALENDAR_CATALOG_CONFLICT;
          setError(conflict ? "conflict" : "refreshFailed");
          return;
        }
        setPublished(result.data);
      } catch {
        setError("refreshFailed");
        return;
      }
      await refreshSaved("loadFailed");
    });
  }
  function select(row: GoogleCalendarCatalogEntry): void {
    connection.runCatalog(accountId, async () => {
      setError(null);
      setSaved(false);
      try {
        const result = await setGoogleCalendarSelectionAction(
          {
            accountId,
            calendarId: row.id,
            selected: row.selection?.selected !== true,
            expectedCatalogRevision: data?.revision ?? 0,
            expectedBindingVersion: row.selection?.version ?? null,
          },
          readCsrfToken(),
        );
        if (!result.ok) {
          const conflict = result.error.id === ERROR_IDS.CALENDAR_BINDING_CONFLICT;
          setError(conflict ? "conflict" : "selectionFailed");
          setBlocked(true);
          return;
        }
        setReceipts((previous) => ({ ...previous, [row.id]: result.data }));
        setSaved(true);
      } catch {
        setError("selectionFailed");
        setBlocked(true);
        return;
      }
      // The action committed. A failed saved-list read cannot reverse its receipt or ack.
      await refreshSaved("loadFailed");
    });
  }
  function review(): void {
    connection.runCatalog(accountId, () =>
      refreshSaved(error === "conflict" ? "conflict" : "loadFailed"),
    );
  }
  function retry(): void {
    connection.runCatalog(accountId, () => refreshSaved("loadFailed"));
  }
  return {
    data,
    rows,
    saved,
    discover,
    select,
    review,
    retry,
    error: error ?? (query.isError ? "loadFailed" : null),
    blocked: blocked || query.isError,
  };
}
