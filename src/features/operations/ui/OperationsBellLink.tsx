"use client";

import { useCallback } from "react";
import { trpc } from "@/lib/trpc-client";
import { useOperationsLabels } from "./OperationsShared";
import { createOperationsReadSlot } from "./readCycle";
import { useOperationsRead } from "./useOperationsRead";

const slot = createOperationsReadSlot();

/** Mounted only while an administrator has the notification popover open. */
export function OperationsBellLink({ onOpen }: { onOpen: () => void }) {
  const labels = useOperationsLabels();
  const client = trpc.useUtils().client;
  const read = useCallback(
    (signal: AbortSignal) => client.operations.bell.query(undefined, { signal }),
    [client],
  );
  const { data, denied, failure } = useOperationsRead("operations-bell", read, slot);
  if (denied || failure !== null || data?.hasOpenIncidents !== true) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full border-t px-3 py-2 text-start text-xs text-link hover:underline"
    >
      {labels.bellOpenIncidents}
    </button>
  );
}
