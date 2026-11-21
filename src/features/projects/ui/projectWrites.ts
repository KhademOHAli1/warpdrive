import { useRef, useState } from "react";
import type { ProjectResult } from "../contracts";

export type ProjectWriteError = Extract<ProjectResult<never>, { ok: false }>["error"];

export function useProjectWrites() {
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ProjectWriteError | null>(null);

  async function execute<T>(
    write: () => Promise<ProjectResult<T>>,
    save: (value: T) => void,
    report = true,
  ): Promise<ProjectResult<T>> {
    if (inFlight.current) return { ok: false, error: "project_conflict" };
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await write();
      if (result.ok) save(result.value);
      else if (report) setError(result.error);
      return result;
    } catch {
      if (report) setError("project_unavailable");
      return { ok: false, error: "project_unavailable" };
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return { execute, pending, error };
}
