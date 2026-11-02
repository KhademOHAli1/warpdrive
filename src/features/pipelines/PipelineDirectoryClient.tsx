"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { readCsrfToken } from "@/utils/csrfCookie";
import type { PipelineDirectoryData } from "./lifecycleTypes";
import { PipelineDirectory } from "./PipelineDirectory";
import { archivePipelineAction, restorePipelineAction } from "./pipelineLifecycleActions";

export function PipelineDirectoryClient({
  rows,
  snapshotId,
}: {
  rows: PipelineDirectoryData[];
  snapshotId: string;
}): ReactNode {
  const router = useRouter();
  return (
    <PipelineDirectory
      rows={rows}
      canManage
      enabled
      snapshotId={snapshotId}
      onArchive={(input) => archivePipelineAction(input, readCsrfToken())}
      onRestore={(input) => restorePipelineAction(input, readCsrfToken())}
      onRefresh={() => router.refresh()}
    />
  );
}
