import { createHash, randomUUID } from "node:crypto";
import { env } from "@/config/env";
import type { Db } from "@/db/client";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { makeStorageClient, type StorageClient } from "@/features/files/storage";
import type { HydratedActor } from "@/server/hydrateActor";
import type { EquipmentAuditEvidence, EquipmentAuditWrite } from "./contracts";
import {
  auditPhotoMaxBytes,
  type EquipmentAuditPhotoMime,
  equipmentAuditEvidencePath,
} from "./evidenceTransport";
import {
  lockAuditRequest,
  persistAuditChange,
  readAuditEvidenceRecord,
  type StoredAuditPhoto,
} from "./repository";
import { auditInvalid, auditUnavailable, readAuditAuthority, withAuditAuthority } from "./scope";
import { loadAuditInteraction, priorAuditRequest, refreshAuditWrite } from "./service";
import { applyAuditPhoto } from "./transitions";

type Photo = {
  auditId: string;
  rowId: string | null;
  version: number;
  requestId: string;
  source: EquipmentAuditEvidence["source"];
  name: string;
  mime: EquipmentAuditPhotoMime;
  bytes: Uint8Array;
  expectedActorId: string;
};

type EvidenceRead =
  | { ok: true; value: { bytes: Uint8Array; mime: EquipmentAuditPhotoMime } }
  | typeof auditUnavailable;

const storageFailure = { ok: false, error: "storage" } as const;

function digest(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function planPhoto(
  tx: Db,
  actor: HydratedActor,
  photo: Photo,
  sha256: string,
  mode: "read" | "write",
) {
  if (actor.id !== photo.expectedActorId) return auditUnavailable;
  const authority = await readAuditAuthority(tx, actor);
  if (mode === "write") await lockAuditRequest(tx, actor.id, photo.requestId);
  const { auditId, rowId, version, requestId, source, name } = photo;
  const interaction = await loadAuditInteraction(tx, authority, auditId, mode);
  if (interaction === null) return auditUnavailable;

  const original = JSON.stringify({
    type: "photo",
    auditId,
    rowId,
    version,
    source,
    name,
    digest: sha256,
  });
  const { siteId, record } = interaction;
  const prior = await priorAuditRequest(
    tx,
    interaction.state,
    actor.id,
    requestId,
    siteId,
    auditId,
    original,
  );
  const now = new Date().toISOString();
  const changed = applyAuditPhoto(
    prior.state,
    authority.viewer,
    { auditId, rowId, version, requestId, source, name, fingerprint: sha256 },
    { now, makeId: randomUUID },
    equipmentAuditEvidencePath,
  );
  if (!changed.ok) return changed;
  return {
    ok: true,
    result: { ok: true, detail: changed.detail, workspace: changed.workspace },
    change: changed.change,
    record,
    receipt: {
      id: randomUUID(),
      requestId,
      actorId: actor.id,
      siteId,
      sourceAuditId: auditId,
      fingerprint: prior.digest,
      at: new Date(now),
    },
  } as const;
}

async function awaitAuditStorage<T>(transfer: Promise<T>, signal: AbortSignal) {
  let removeListener = () => {};
  const cancelled = new Promise<never>((_resolve, reject) => {
    const abort = () =>
      reject(new DOMException("Equipment audit storage request expired", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    removeListener = () => signal.removeEventListener("abort", abort);
    if (signal.aborted) abort();
  });
  try {
    return await Promise.race([transfer, cancelled]);
  } finally {
    removeListener();
  }
}

async function discardAuditUpload(storage: StorageClient, objectKey: string) {
  try {
    const cleanup = AbortSignal.timeout(4000);
    await awaitAuditStorage(storage.deleteObject(objectKey, cleanup), cleanup);
  } catch {
    // A losing attempt uses an isolated private key and cannot delete another receipt's bytes.
  }
}

export async function attachEquipmentAuditEvidence(
  db: Db,
  who: NativeSessionRef,
  photo: Photo,
  signal: AbortSignal,
  storage: StorageClient = makeStorageClient(),
): Promise<EquipmentAuditWrite> {
  if (
    photo.bytes.length === 0 ||
    photo.bytes.length > Math.min(auditPhotoMaxBytes, env.MAX_FILE_BYTES)
  )
    return auditInvalid;
  const bytes = Buffer.from(photo.bytes);
  const sha256 = digest(bytes);
  const admitted = await withAuditAuthority(db, who, signal, (tx, actor) =>
    planPhoto(tx, actor, photo, sha256, "read"),
  );
  if (!admitted.ok) return admitted;
  if (admitted.change === null) return refreshAuditWrite(db, who, signal, admitted.result);

  const suffix = photo.mime === "image/png" ? "png" : "jpg";
  const objectKey = `asset-audit-evidence/${admitted.receipt.siteId}/${photo.auditId}/${randomUUID()}.${suffix}`;
  signal.throwIfAborted();
  const upload = storage.putObjectBytes(objectKey, bytes, photo.mime, signal);
  const stored = await awaitAuditStorage(upload, signal).catch((error: unknown) => {
    if (signal.aborted) {
      const discard = () => discardAuditUpload(storage, objectKey);
      void upload.then(discard, discard);
    }
    throw error;
  });
  if (!stored.ok) {
    await discardAuditUpload(storage, objectKey);
    return storageFailure;
  }

  const metadata: StoredAuditPhoto = {
    objectKey,
    sha256,
    contentType: photo.mime,
    sizeBytes: bytes.length,
  };
  // If commit is ambiguous, leave the isolated object private for confirmation by retry.
  const saved = await withAuditAuthority(db, who, signal, async (tx, actor) => {
    const plan = await planPhoto(tx, actor, photo, sha256, "write");
    if (!plan.ok) return plan;
    if (plan.change !== null) {
      await persistAuditChange(tx, plan.record, plan.change, plan.receipt, metadata);
    }
    return { ...plan.result, stored: plan.change !== null };
  });
  if (!saved.ok || !saved.stored) await discardAuditUpload(storage, objectKey);
  if (!saved.ok) return saved;
  return refreshAuditWrite(db, who, signal, {
    ok: true,
    workspace: saved.workspace,
    detail: saved.detail,
  });
}

async function authorizedEvidence(
  db: Db,
  who: NativeSessionRef,
  { auditId, evidenceId }: { auditId: string; evidenceId: string },
  signal: AbortSignal,
) {
  return withAuditAuthority(db, who, signal, async (tx, actor) => {
    const authority = await readAuditAuthority(tx, actor);
    const interaction = await loadAuditInteraction(tx, authority, auditId, "read");
    if (interaction === null) return auditUnavailable;
    const evidence = await readAuditEvidenceRecord(tx, interaction.siteId, auditId, evidenceId);
    return evidence === undefined ? auditUnavailable : ({ ok: true, value: evidence } as const);
  });
}

export async function readEquipmentAuditEvidence(
  db: Db,
  who: NativeSessionRef,
  input: { auditId: string; evidenceId: string },
  signal: AbortSignal,
  storage: StorageClient = makeStorageClient(),
): Promise<EvidenceRead> {
  const authorized = await authorizedEvidence(db, who, input, signal);
  if (!authorized.ok) return authorized;
  const { objectKey, sizeBytes, contentType, sha256 } = authorized.value;
  signal.throwIfAborted();
  const bytes = await awaitAuditStorage(
    storage.getObjectBytes(objectKey, signal, sizeBytes),
    signal,
  );
  if (!bytes.ok || bytes.value.length !== sizeBytes || digest(bytes.value) !== sha256)
    return auditUnavailable;
  const current = await authorizedEvidence(db, who, input, signal);
  if (!current.ok || current.value.objectKey !== objectKey) return auditUnavailable;
  return { ok: true, value: { bytes: bytes.value, mime: contentType } };
}
