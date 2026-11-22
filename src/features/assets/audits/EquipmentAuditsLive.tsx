"use client";

import { useMemo } from "react";
import { z } from "zod";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { readCsrfToken } from "@/utils/csrfCookie";
import type {
  EquipmentAuditAccess,
  EquipmentAuditAttach,
  EquipmentAuditError,
  EquipmentAuditWorkspace,
  EquipmentAuditWrite,
} from "./contracts";
import { auditPhotoHeaders, equipmentAuditEvidencePath } from "./evidenceTransport";
import { EquipmentAuditsWorkspace } from "./ui/EquipmentAuditsWorkspace";
import {
  executeEquipmentAuditAction,
  lookupEquipmentAuditAction,
  readEquipmentAuditAction,
} from "./webActions";

const refusal = z.strictObject({
  ok: z.literal(false),
  error: z.enum(["invalid", "unavailable", "stale", "conflict", "state", "quantity", "storage"]),
});

const success = z.object({
  ok: z.literal(true),
  workspace: z.object({
    viewerId: z.uuid(),
    sites: z.array(z.unknown()),
    audits: z.array(z.unknown()),
  }),
  detail: z.object({
    id: z.uuid(),
    version: z.number().int().positive(),
    rows: z.array(z.unknown()),
    activity: z.array(z.unknown()),
    evidence: z.array(z.unknown()),
  }),
});

const definiteFailures: Record<number, readonly EquipmentAuditError[]> = {
  400: ["invalid"],
  403: ["unavailable"],
  404: ["unavailable"],
  409: ["stale", "conflict", "state", "quantity"],
  413: ["invalid"],
  415: ["invalid"],
  503: ["storage"],
};

async function uploadEvidence(
  actorId: string,
  input: EquipmentAuditAttach,
): Promise<EquipmentAuditWrite> {
  const headers = new Headers({
    accept: "application/json",
    "content-type": input.file.type,
    [auditPhotoHeaders.actor]: actorId,
    [auditPhotoHeaders.version]: String(input.version),
    [auditPhotoHeaders.request]: input.requestId,
    [auditPhotoHeaders.source]: input.source,
    [auditPhotoHeaders.name]: encodeURIComponent(input.file.name),
  });
  const csrf = readCsrfToken();
  if (csrf !== null) headers.set(auditPhotoHeaders.csrf, csrf);
  if (input.rowId !== null) headers.set(auditPhotoHeaders.row, input.rowId);
  const response = await fetch(equipmentAuditEvidencePath(input.auditId), {
    method: "POST",
    credentials: "same-origin",
    redirect: "error",
    cache: "no-store",
    headers,
    body: input.file,
  });
  const data: unknown = await response.json();
  if (response.status === 200) {
    const parsed = success.safeParse(data);
    if (
      parsed.success &&
      parsed.data.workspace.viewerId === actorId &&
      parsed.data.detail.id === input.auditId
    )
      return data as Extract<EquipmentAuditWrite, { ok: true }>;
  } else {
    const parsed = refusal.safeParse(data);
    if (parsed.success && definiteFailures[response.status]?.includes(parsed.data.error) === true)
      return parsed.data;
  }
  // The command may have committed if the proxy failed or the response was interrupted.
  throw new AppError(
    ERROR_IDS.FILE_UPLOAD_RESPONSE_INVALID,
    "Invalid equipment audit upload response",
  );
}

export function EquipmentAuditsLive({
  initial,
  actorId,
  initialAuditId,
  canBrowseAssets,
}: {
  initial: EquipmentAuditWorkspace;
  actorId: string;
  initialAuditId?: string;
  canBrowseAssets: boolean;
}) {
  const access = useMemo<EquipmentAuditAccess>(
    () => ({
      read: (auditId) => readEquipmentAuditAction(actorId, auditId, readCsrfToken()),
      submit: (command) => executeEquipmentAuditAction(actorId, command, readCsrfToken()),
      lookup: (auditId, code) =>
        lookupEquipmentAuditAction(actorId, auditId, code, readCsrfToken()),
      attach: (input) => uploadEvidence(actorId, input),
    }),
    [actorId],
  );
  return (
    <EquipmentAuditsWorkspace
      initial={initial}
      access={access}
      fixture={false}
      initialAuditId={initialAuditId}
      canBrowseAssets={canBrowseAssets}
    />
  );
}
