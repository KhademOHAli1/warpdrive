"use client";

import { useCallback, useEffect, useState } from "react";
import { readKpiWorkspaceAction } from "@/features/goals/kpiActions";
import type { KpiWorkspace } from "@/features/goals/kpiModel";

export function useKpiWorkspace(on: string) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    on: string;
    revision: number;
    data: KpiWorkspace | null;
    error: string | null;
  } | null>(null);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    let active = true;
    async function read() {
      try {
        const response = await readKpiWorkspaceAction(on);
        if (active)
          setResult({
            on,
            revision,
            data: response.ok ? response.value : null,
            error: response.ok ? null : response.error.id,
          });
      } catch {
        if (active) setResult({ on, revision, data: null, error: "E_KPI_FAILED" });
      }
    }
    void read();
    return () => {
      active = false;
    };
  }, [on, revision]);
  const loading = result?.on !== on || result.revision !== revision;
  return {
    data: loading ? null : result.data,
    loading,
    error: loading ? null : result.error,
    reload,
  };
}
