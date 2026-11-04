"use client";

import { useRef, useState } from "react";
import { z } from "zod";
import { trpc } from "@/lib/trpc-client";
import { libraryReadDenied } from "./libraryErrors";
import type { PaletteRead } from "./paletteView";

const uuid = z.string().uuid();

export function useWorkflowPalette(workflowId: string, open: boolean): PaletteRead {
  const enabled = open && uuid.safeParse(workflowId).success;
  const query = trpc.workflows.palette.useQuery(
    { id: workflowId },
    { enabled, refetchOnMount: "always", staleTime: 0 },
  );
  const [retrying, setRetrying] = useState(false);
  const retryGuard = useRef(false);
  const denied = query.isError && libraryReadDenied(query.error);
  const data = !denied && query.data?.workflowId === workflowId ? query.data : undefined;
  function status(): PaletteRead["status"] {
    if (denied) return "denied";
    if (!enabled) return "loading";
    if (query.isError) return "error";
    if (query.isLoading || query.isFetching || data === undefined) return "loading";
    return "ready";
  }
  async function retry(): Promise<unknown> {
    if (!enabled || retryGuard.current || query.isFetching) return undefined;
    retryGuard.current = true;
    setRetrying(true);
    try {
      return await query.refetch();
    } finally {
      retryGuard.current = false;
      setRetrying(false);
    }
  }
  return { status: status(), workflowId, data, retry, retrying };
}
