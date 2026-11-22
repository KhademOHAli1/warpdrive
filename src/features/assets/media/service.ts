import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import sharp from "sharp";
import { env } from "@/config/env";
import type { Db } from "@/db/client";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { makeStorageClient, type StorageClient } from "@/features/files/storage";
import type { HydratedActor } from "@/server/hydrateActor";
import type {
  AssetMediaFile,
  AssetMediaKind,
  AssetMediaResult,
  AssetMediaRevision,
  AssetMediaTarget,
  AssetMediaWorkspace,
} from "./contracts";
import { assetMediaUploadMetadata, hasAssetMediaSignature } from "./fileRules";
import { assetMediaCoverInput, assetMediaTargetInput } from "./nativeContracts";
import {
  persistAssetMediaEvent,
  readAssetMediaEvents,
  readAssetMediaReceipt,
  type StoredAssetMediaEvent,
} from "./repository";
import {
  type AssetMediaOwner,
  assetMediaUnavailable,
  readAssetMediaOwner,
  withAssetMediaAuthority,
} from "./scope";
import { type AssetMediaFileView, assetMediaPath } from "./transport";

const invalid = { ok: false, error: "invalid" } as const;
const conflict = { ok: false, error: "conflict" } as const;
const storageFailure = { ok: false, error: "storage" } as const;

type FileStorage = Pick<StorageClient, "putObjectBytes" | "getObjectBytes" | "deleteObject">;
type UploadBytes = AssetMediaRevision & {
  expectedActorId: string;
  kind: AssetMediaKind;
  name: string;
  mime: string;
  bytes: Uint8Array;
};

function fileDigest(bytes: Uint8Array | string) {
  return createHash("sha256").update(bytes).digest("hex");
}

function describeFile(
  target: AssetMediaTarget,
  event: StoredAssetMediaEvent,
): AssetMediaFile | null {
  const { id, kind, name, mime, sizeBytes, at, actor } = event;
  if (
    event.type !== "uploaded" ||
    kind === null ||
    name === null ||
    mime === null ||
    sizeBytes === null
  )
    return null;
  return {
    id,
    kind,
    name,
    mime,
    sizeBytes,
    uploadedAt: at.toISOString(),
    uploadedBy: actor || "—",
    previewHref: kind === "photo" ? assetMediaPath(target, id, "preview") : null,
    downloadHref: assetMediaPath(target, id),
  };
}

function currentCover(events: StoredAssetMediaEvent[]) {
  return (
    events.find(({ kind, type }) => kind === "photo" || type === "cover_changed")?.fileId ?? null
  );
}

function revision(events: StoredAssetMediaEvent[]) {
  return events[0]?.version ?? 0;
}

async function projectMedia(
  tx: Db,
  owner: AssetMediaOwner,
  target: AssetMediaTarget,
  events: StoredAssetMediaEvent[],
): Promise<AssetMediaWorkspace> {
  let inheritedCover: AssetMediaFile | null = null;
  if (owner.modelId !== null) {
    const model: AssetMediaTarget = { type: "model", id: owner.modelId };
    const modelEvents = await readAssetMediaEvents(tx, owner.siteId, model);
    const id = currentCover(modelEvents);
    const inherited = modelEvents.find((event) => event.id === id && event.kind === "photo");
    if (inherited !== undefined) inheritedCover = describeFile(model, inherited);
  }
  const files = events.flatMap((event) => {
    const file = describeFile(target, event);
    return file === null ? [] : [file];
  });
  return {
    target,
    version: revision(events),
    canManage: owner.canManage,
    files,
    coverId: currentCover(events),
    inheritedCover,
    history: events.map(({ id, type, fileId, at, actor }) => ({
      id,
      type,
      fileId,
      at: at.toISOString(),
      actor: actor || "—",
    })),
  };
}

export async function readAssetMediaWorkspace(
  db: Db,
  who: NativeSessionRef,
  raw: unknown,
  signal: AbortSignal,
): Promise<AssetMediaResult> {
  const parsed = assetMediaTargetInput.safeParse(raw);
  if (!parsed.success) return invalid;
  const target = parsed.data;
  return withAssetMediaAuthority(db, who, signal, async (tx, actor) => {
    const owner = await readAssetMediaOwner(tx, actor, target);
    if (owner === null) return assetMediaUnavailable;
    const events = await readAssetMediaEvents(tx, owner.siteId, target);
    return { ok: true, value: await projectMedia(tx, owner, target, events) };
  });
}

async function lockMediaWrite(
  tx: Db,
  actorId: string,
  input: AssetMediaRevision,
  signal: AbortSignal,
) {
  const request = `${actorId}:${input.requestId}`;
  const target = `${input.target.type}:${input.target.id}`;
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('asset-media-request'), hashtext(${request}))`,
  );
  signal.throwIfAborted();
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('asset-media-target'), hashtext(${target}))`,
  );
  signal.throwIfAborted();
}

async function planWrite(
  tx: Db,
  actor: HydratedActor,
  input: AssetMediaRevision,
  fingerprint: string,
  signal: AbortSignal,
  commit: boolean,
) {
  const { target, requestId, version } = input;
  const owner = await readAssetMediaOwner(tx, actor, target);
  if (owner?.canManage !== true) return assetMediaUnavailable;
  if (commit) await lockMediaWrite(tx, actor.id, input, signal);
  const receipt = await readAssetMediaReceipt(tx, actor.id, requestId);
  if (
    receipt !== undefined &&
    (receipt.siteId !== owner.siteId ||
      receipt.target.type !== target.type ||
      receipt.target.id !== target.id ||
      receipt.fingerprint !== fingerprint)
  )
    return conflict;
  const events = await readAssetMediaEvents(tx, owner.siteId, target);
  if (receipt === undefined && revision(events) !== version) return conflict;
  return { ok: true, owner, events, replay: receipt !== undefined } as const;
}

export async function selectAssetMediaCover(
  db: Db,
  who: NativeSessionRef,
  raw: unknown,
  signal: AbortSignal,
): Promise<AssetMediaResult> {
  const parsed = assetMediaCoverInput.safeParse(raw);
  if (!parsed.success) return invalid;
  const input = parsed.data;
  const { target, requestId, fileId, version } = input;
  const fingerprint = fileDigest(
    JSON.stringify(["cover", target.type, target.id, version, fileId]),
  );
  return withAssetMediaAuthority(db, who, signal, async (tx, actor) => {
    const planned = await planWrite(tx, actor, input, fingerprint, signal, true);
    if (!planned.ok) return planned;
    const { owner, events, replay } = planned;
    if (replay) return { ok: true, value: await projectMedia(tx, owner, target, events) };
    if (
      currentCover(events) === fileId ||
      (fileId !== null && !events.some(({ id, kind }) => id === fileId && kind === "photo"))
    )
      return invalid;
    const event: Omit<StoredAssetMediaEvent, "actor"> = {
      id: randomUUID(),
      version: version + 1,
      type: "cover_changed",
      fileId,
      at: new Date(),
      kind: null,
      name: null,
      mime: null,
      sizeBytes: null,
      sha256: null,
      objectKey: null,
    };
    await persistAssetMediaEvent(tx, {
      siteId: owner.siteId,
      target,
      event,
      actorId: actor.id,
      requestId,
      fingerprint,
    });
    return {
      ok: true,
      value: await projectMedia(tx, owner, target, [{ ...event, actor: actor.name }, ...events]),
    };
  });
}

async function decodablePhoto(bytes: Buffer, contentType: string) {
  try {
    const image = sharp(bytes, { failOn: "warning", limitInputPixels: 20_000_000 }).timeout({
      seconds: 8,
    });
    const { format, pages } = await image.metadata();
    if (`image/${format}` !== contentType || (pages ?? 1) !== 1) return false;
    await image.stats();
    return true;
  } catch {
    return false;
  }
}

async function waitForStorage<T>(transfer: Promise<T>, signal: AbortSignal) {
  let removeListener = () => {};
  const cancelled = new Promise<never>((_resolve, reject) => {
    const abort = () => reject(new DOMException("Equipment media storage expired", "AbortError"));
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

async function discardUpload(storage: FileStorage, key: string) {
  try {
    const signal = AbortSignal.timeout(4_000);
    await waitForStorage(storage.deleteObject(key, signal), signal);
  } catch {
    // This isolated object was never selected by a committed file record.
  }
}

export async function uploadAssetMediaFile(
  db: Db,
  who: NativeSessionRef,
  input: UploadBytes,
  signal: AbortSignal,
  storage: FileStorage = makeStorageClient(),
): Promise<AssetMediaResult> {
  const { target, kind, name, mime, requestId, version, expectedActorId } = input;
  const metadata = assetMediaUploadMetadata({
    target,
    kind,
    name,
    mime,
    sizeBytes: input.bytes.byteLength,
  });
  if (metadata === null || metadata.sizeBytes > env.MAX_FILE_BYTES) return invalid;
  const bytes = Buffer.from(input.bytes);
  if (!hasAssetMediaSignature(bytes, metadata.mime)) return invalid;
  const sha256 = fileDigest(bytes);
  const fingerprint = fileDigest(
    JSON.stringify(["upload", target.type, target.id, version, kind, metadata, sha256]),
  );
  const admitted = await withAssetMediaAuthority(db, who, signal, async (tx, actor) => {
    if (actor.id !== expectedActorId) return assetMediaUnavailable;
    const plan = await planWrite(tx, actor, input, fingerprint, signal, false);
    if (!plan.ok) return plan;
    if (plan.replay)
      return {
        ok: true,
        stage: "replay",
        value: await projectMedia(tx, plan.owner, target, plan.events),
      } as const;
    return { ok: true, stage: "transfer", siteId: plan.owner.siteId } as const;
  });
  if (!admitted.ok) return admitted;
  if (admitted.stage === "replay") return { ok: true, value: admitted.value };
  if (kind === "photo" && !(await decodablePhoto(bytes, metadata.mime))) return invalid;
  signal.throwIfAborted();
  const objectKey = `asset-media/${admitted.siteId}/${target.type}/${target.id}/${randomUUID()}`;
  const transfer = storage.putObjectBytes(objectKey, bytes, metadata.mime, signal);
  const stored = await waitForStorage(transfer, signal).catch((error: unknown) => {
    const discard = () => discardUpload(storage, objectKey);
    void transfer.then(discard, discard);
    throw error;
  });
  if (!stored.ok) {
    await discardUpload(storage, objectKey);
    return storageFailure;
  }
  if (signal.aborted) {
    await discardUpload(storage, objectKey);
    signal.throwIfAborted();
  }
  const id = randomUUID();
  const event: Omit<StoredAssetMediaEvent, "actor"> = {
    id,
    version: version + 1,
    type: "uploaded",
    fileId: id,
    at: new Date(),
    kind,
    ...metadata,
    sha256,
    objectKey,
  };
  // A commit acknowledgement may be lost. Keep those bytes for exact retry.
  const saved = await withAssetMediaAuthority(db, who, signal, async (tx, actor) => {
    if (actor.id !== expectedActorId) return assetMediaUnavailable;
    const plan = await planWrite(tx, actor, input, fingerprint, signal, true);
    if (!plan.ok) return plan;
    const { owner, events, replay } = plan;
    if (owner.siteId !== admitted.siteId) return assetMediaUnavailable;
    if (!replay)
      await persistAssetMediaEvent(tx, {
        siteId: owner.siteId,
        target,
        event,
        actorId: actor.id,
        requestId,
        fingerprint,
      });
    const visible = replay ? events : [{ ...event, actor: actor.name }, ...events];
    return {
      ok: true,
      value: await projectMedia(tx, owner, target, visible),
      committed: !replay,
    } as const;
  });
  if (!saved.ok || !saved.committed) await discardUpload(storage, objectKey);
  return saved.ok ? { ok: true, value: saved.value } : saved;
}

async function authorizedFile(
  db: Db,
  who: NativeSessionRef,
  target: AssetMediaTarget,
  fileId: string,
  view: AssetMediaFileView,
  signal: AbortSignal,
) {
  return withAssetMediaAuthority(db, who, signal, async (tx, actor) => {
    const owner = await readAssetMediaOwner(tx, actor, target);
    if (owner === null) return assetMediaUnavailable;
    const events = await readAssetMediaEvents(tx, owner.siteId, target);
    const event = events.find(({ id, type }) => id === fileId && type === "uploaded");
    if (
      event === undefined ||
      event.name === null ||
      event.mime === null ||
      event.sizeBytes === null ||
      event.sha256 === null ||
      event.objectKey === null ||
      (view === "preview" && event.kind !== "photo")
    )
      return assetMediaUnavailable;
    const { name, mime, sizeBytes, sha256, objectKey } = event;
    return { ok: true, value: { name, mime, sizeBytes, sha256, objectKey } } as const;
  });
}

export async function readAssetMediaFile(
  db: Db,
  who: NativeSessionRef,
  { target, fileId, view }: { target: AssetMediaTarget; fileId: string; view: AssetMediaFileView },
  signal: AbortSignal,
  storage: FileStorage = makeStorageClient(),
) {
  const admitted = await authorizedFile(db, who, target, fileId, view, signal);
  if (!admitted.ok) return admitted;
  const { objectKey, sizeBytes, sha256, name, mime } = admitted.value;
  signal.throwIfAborted();
  const bytes = await waitForStorage(storage.getObjectBytes(objectKey, signal, sizeBytes), signal);
  if (!bytes.ok || bytes.value.byteLength !== sizeBytes || fileDigest(bytes.value) !== sha256)
    return assetMediaUnavailable;
  const current = await authorizedFile(db, who, target, fileId, view, signal);
  if (!current.ok || current.value.objectKey !== objectKey) return assetMediaUnavailable;
  return { ok: true, value: { bytes: bytes.value, name, mime } } as const;
}
