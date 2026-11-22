"use client";

import { TRPCClientError } from "@trpc/client";
import { useMemo } from "react";
import { useNativeActor } from "@/features/identity/NativeActorProvider";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import { uploadReleaseFile } from "../../uploadReleaseFile";
import type {
  ExportIntakeAccess,
  ExportIntakeBinding,
  ExportIntakeJob,
  ExportIntakeResult,
} from "../contracts";
import {
  prepareExportIntakeAction,
  queueExportIntakeAction,
  retryExportIntakeAction,
} from "../webActions";
import { ExportIntakePanel } from "./ExportIntakePanel";

const unavailable = {
  ok: false,
  issues: [{ code: "unavailable" }],
} as const satisfies ExportIntakeResult<never>;

async function submitExportBundle(
  actorId: string,
  { files, ...input }: Parameters<ExportIntakeAccess["submit"]>[0],
): ReturnType<ExportIntakeAccess["submit"]> {
  const prepared = await prepareExportIntakeAction(actorId, input, readCsrfToken());
  if (!prepared.ok) return prepared;
  if (prepared.value.state === "known") return { ok: true, value: prepared.value.job };
  const byName = new Map(files.map((file) => [file.name, file]));
  for (const { name, contentType, post } of prepared.value.uploads) {
    const file = byName.get(name);
    if (file === undefined) return { ok: false, issues: [{ code: "missingFile", file: name }] };
    if (!(await uploadReleaseFile(post, file, contentType)))
      return { ok: false, issues: [{ code: "temporary", file: name }] };
  }
  return queueExportIntakeAction(
    actorId,
    { target: input.target, requestId: input.requestId, jobId: prepared.value.jobId },
    readCsrfToken(),
  );
}

export function NativeExportIntake({
  target,
  canEdit,
  onReady,
}: {
  target: ExportIntakeBinding;
  canEdit: boolean;
  onReady: (job: ExportIntakeJob) => void;
}) {
  const { actorId } = useNativeActor();
  const client = trpc.useUtils().client;
  const access = useMemo<ExportIntakeAccess>(
    () => ({
      async list(binding, signal) {
        if (actorId === null) return unavailable;
        try {
          return await client.inventory.releases.intake.jobs.query(
            { ...binding, actorId },
            { signal },
          );
        } catch (error) {
          const data: unknown = error instanceof TRPCClientError ? error.data : undefined;
          if (
            data !== null &&
            typeof data === "object" &&
            "code" in data &&
            data.code === "UNAUTHORIZED"
          )
            return unavailable;
          throw error;
        }
      },
      submit: (input) =>
        actorId === null ? Promise.resolve(unavailable) : submitExportBundle(actorId, input),
      retry: (input) =>
        actorId === null
          ? Promise.resolve(unavailable)
          : retryExportIntakeAction(actorId, input, readCsrfToken()),
    }),
    [actorId, client],
  );
  return actorId === null ? null : <ExportIntakePanel {...{ target, access, canEdit, onReady }} />;
}
