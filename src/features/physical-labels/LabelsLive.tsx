"use client";

import { useCallback } from "react";
import { readCsrfToken } from "@/utils/csrfCookie";
import type { LabelsWorkspace, ScanInput } from "./contracts";
import { LabelScanner } from "./ui/LabelScanner";
import { LabelWorkspace } from "./ui/LabelWorkspace";
import { executePhysicalLabelAction, resolvePhysicalLabelAction } from "./webActions";

export function LabelsLive({ actorId, initial }: { actorId: string; initial: LabelsWorkspace }) {
  return (
    <LabelWorkspace
      initial={initial}
      submit={(command) => executePhysicalLabelAction(actorId, command, readCsrfToken())}
      fixture={false}
    />
  );
}

export function LabelScannerLive({
  actorId,
  initialCode,
}: {
  actorId: string;
  initialCode?: string;
}) {
  const resolve = useCallback(
    (input: ScanInput) => resolvePhysicalLabelAction(actorId, input, readCsrfToken()),
    [actorId],
  );
  return <LabelScanner initialCode={initialCode} resolve={resolve} registryVisible />;
}
