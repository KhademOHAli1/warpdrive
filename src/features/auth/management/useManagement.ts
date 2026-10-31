"use client";
import { useCallback, useEffect, useState } from "react";
import { readCsrfToken } from "@/utils/csrfCookie";
import {
  managementBulkResponse,
  managementReadResponse,
  managementWriteResponse,
} from "./clientSchemas";
import type { ManagementQuery, ManagementSnapshot } from "./contracts";
import type { ManagementAction } from "./schemas";

function commandError(raw: unknown, bulk: boolean): string | null {
  if (bulk) {
    const result = managementBulkResponse.safeParse(raw);
    if (!result.success) return "failed";
    if (!result.data.ok) return result.data.error;
    return result.data.data.results.some((row) => !row.ok) ? "bulk_partial" : null;
  }
  const result = managementWriteResponse.safeParse(raw);
  if (!result.success) return "failed";
  return result.data.ok ? null : result.data.error;
}

export function useManagement(query: ManagementQuery) {
  const [snapshot, setSnapshot] = useState<ManagementSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: A completed action increments revision to reload the server snapshot.
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      q: query.q,
      status: query.status,
      page: String(query.page),
      auditQ: query.auditQ ?? "",
      auditOutcome: query.auditOutcome ?? "all",
      auditPage: String(query.auditPage ?? 1),
    });
    void (async () => {
      try {
        const response = await fetch(`/api/auth-management?${params}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        const result = managementReadResponse.safeParse(await response.json());
        controller.signal.throwIfAborted();
        if (!result.success) {
          setLoadError("load_error");
          return;
        }
        if (!result.data.ok) {
          setLoadError(result.data.error);
          return;
        }
        setSnapshot(result.data.data);
        setLoadError(null);
      } catch {
        if (!controller.signal.aborted) setLoadError("load_error");
      }
    })();
    return () => controller.abort();
  }, [
    query.q,
    query.status,
    query.page,
    query.auditQ,
    query.auditOutcome,
    query.auditPage,
    revision,
  ]);

  async function send(command: ManagementAction): Promise<boolean> {
    if (pending) return false;
    setPending(true);
    setActionError(null);
    setSaved(false);
    try {
      const response = await fetch("/api/auth-management", {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": readCsrfToken() ?? "" },
        body: JSON.stringify(command),
        signal: AbortSignal.timeout(15000),
      });
      const error = commandError(await response.json(), command.action === "bulkActive");
      if (error !== null) {
        setActionError(error);
        if (error === "bulk_partial") reload();
        return false;
      }
      setSaved(true);
      reload();
      return true;
    } catch {
      setActionError("failed");
      return false;
    } finally {
      setPending(false);
    }
  }
  return { snapshot, error: actionError ?? loadError, pending, saved, reload, send };
}
