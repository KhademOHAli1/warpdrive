import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { env } from "@/config/env";
import type { Db } from "@/db/client";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { validateDisplayFilename } from "@/features/files/keys";
import {
  makeStorageClient,
  type PresignedPost,
  type StorageClient,
} from "@/features/files/storage";
import type { HydratedActor } from "@/server/hydrateActor";
import { err, ok, type Result } from "@/types/result";
import { currentInventoryActor } from "../access";
import { InventoryDomainError } from "../errors";
import { inventoryItems } from "../schema";
import { authorizeArtifactRelease } from "./access";
import { validReleaseArchive } from "./archive";
import { inspectReleaseBom, releaseBomMaxBytes } from "./bomCsv";
import { type ReleaseArtifactKind, releaseFixtureMaxFileBytes } from "./contracts";
import { inventoryReleaseArtifacts, type ReleaseBomEntry } from "./schema";

type Artifact = typeof inventoryReleaseArtifacts.$inferSelect;
type ArtifactUpload = {
  releaseId: string;
  kind: ReleaseArtifactKind;
  name: string;
  sizeBytes: number;
};
type ArtifactTarget = { releaseId: string; artifactId: string };
type ArtifactDownload = { name: string; contentType: string; bytes: Buffer };
type ArtifactResult<T> = Result<T, string>;

const formats: Readonly<Record<ReleaseArtifactKind, Readonly<Record<string, string>>>> = {
  pcbFabrication: { zip: "application/zip" },
  manufacturingBom: { csv: "text/csv" },
  placement: { csv: "text/csv", pos: "text/plain", xy: "text/plain", txt: "text/plain" },
  enclosure: {
    stp: "application/octet-stream",
    step: "application/octet-stream",
    dxf: "application/octet-stream",
    pdf: "application/pdf",
    zip: "application/zip",
  },
  firmware: {
    bin: "application/octet-stream",
    hex: "text/plain",
    uf2: "application/octet-stream",
    zip: "application/zip",
  },
  labelArtwork: {
    pdf: "application/pdf",
    png: "image/png",
    svg: "application/octet-stream",
    zpl: "text/plain",
  },
  testInstructions: {
    pdf: "application/pdf",
    txt: "text/plain",
    md: "text/plain",
    csv: "text/csv",
    zip: "application/zip",
  },
};

const unavailable = "The release file is unavailable.";
const storageUnavailable = "The release file could not be read from storage.";
const verificationFailed = "The release file did not match its stored size, type or checksum.";
const pendingWrongOwner = "Only the uploader can confirm this release file.";
const uploadInvalid = "Use a supported file type for the selected release file role.";
const uploadNameInvalid = "Use a valid release file name of up to 180 characters.";
const uploadSizeInvalid = "The release file size is outside the allowed range.";

function uploadName(raw: string): string | null {
  const filename = validateDisplayFilename(raw.trim());
  if (!filename.ok || filename.value.length === 0 || filename.value.length > 180) return null;
  const compatible = filename.value.normalize("NFKC");
  if (/[/\\<>:"|?*\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(compatible)) return null;
  return filename.value;
}

function uploadType(kind: ReleaseArtifactKind, name: string): string | null {
  const suffix = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  const allowed = formats[kind];
  return name.includes(".") && Object.hasOwn(allowed, suffix) ? (allowed[suffix] ?? null) : null;
}

function artifactSizeLimit(kind: ReleaseArtifactKind) {
  const kindLimit = kind === "manufacturingBom" ? releaseBomMaxBytes : releaseFixtureMaxFileBytes;
  return Math.min(env.MAX_FILE_BYTES, kindLimit);
}

function validSize(sizeBytes: number, maximum: number) {
  return Number.isSafeInteger(sizeBytes) && sizeBytes > 0 && sizeBytes <= maximum;
}

function uploadKey(releaseId: string, artifactId: string) {
  return `inventory-release-uploads/${releaseId}/${artifactId}`;
}

function sealedKey(releaseId: string, artifactId: string) {
  // Each confirmation attempt has its own key. A parallel attempt can never
  // replace the winning artifact, even if it inspected different staging bytes.
  return `confirmed/inventory-release-artifacts/${releaseId}/${artifactId}/${randomUUID()}`;
}

async function withReleaseActor<T>(
  db: Db,
  who: NativeSessionRef,
  signal: AbortSignal,
  action: (tx: Db, actor: HydratedActor) => Promise<ArtifactResult<T>>,
): Promise<ArtifactResult<T>> {
  try {
    return await withCurrentAuthority(db, "read", signal, async (tx) => {
      const actor = await currentInventoryActor(tx, who, signal);
      if (actor === null) return err(unavailable);
      const outcome = await action(tx, actor);
      if ((await currentInventoryActor(tx, who, signal)) === null)
        throw new InventoryDomainError(unavailable);
      return outcome;
    });
  } catch (error) {
    if (error instanceof InventoryDomainError) return err(error.message);
    throw error;
  }
}

async function lockEditableRelease(
  tx: Db,
  actor: HydratedActor,
  releaseId: string,
  signal: AbortSignal,
) {
  const release = await authorizeArtifactRelease(tx, actor, releaseId, "edit", signal);
  // The item lock is shared with grant changes, approval and build creation.
  // Check the latest grant and draft status again after any lock wait.
  await tx
    .select({ id: inventoryItems.id })
    .from(inventoryItems)
    .where(eq(inventoryItems.id, release.itemId))
    .for("update");
  await authorizeArtifactRelease(tx, actor, releaseId, "edit", signal);
}

function targetFilter({ releaseId, artifactId }: ArtifactTarget) {
  return and(
    eq(inventoryReleaseArtifacts.id, artifactId),
    eq(inventoryReleaseArtifacts.releaseId, releaseId),
  );
}

async function findArtifact(tx: Db, target: ArtifactTarget) {
  const [artifact] = await tx.select().from(inventoryReleaseArtifacts).where(targetFilter(target));
  return artifact;
}

function checksum(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

type VerifiedArtifact = { bytes: Buffer; sha256: string; bomEntries: ReleaseBomEntry[] | null };

async function loadStaging(
  storage: StorageClient,
  artifact: Artifact,
  signal: AbortSignal,
): Promise<ArtifactResult<VerifiedArtifact>> {
  if (!validSize(artifact.sizeBytes, artifactSizeLimit(artifact.kind)))
    return err(verificationFailed);
  const head = await storage.headObject(artifact.objectKey, signal);
  if (!head.ok) return err(storageUnavailable);
  if (head.value.size !== artifact.sizeBytes || head.value.contentType !== artifact.contentType)
    return err(verificationFailed);
  const loaded = await storage.getObjectBytes(artifact.objectKey, signal, artifact.sizeBytes);
  if (!loaded.ok || loaded.value.length !== artifact.sizeBytes) return err(verificationFailed);
  return validateStagingBytes(artifact, loaded.value, signal);
}

function validateStagingBytes(
  artifact: Artifact,
  bytes: Buffer,
  signal: AbortSignal,
): ArtifactResult<VerifiedArtifact> {
  if (
    artifact.contentType === "application/zip" &&
    !validReleaseArchive(bytes, artifact.kind === "pcbFabrication", signal)
  ) {
    return err(
      artifact.kind === "pcbFabrication"
        ? "Use a valid ZIP containing Gerber layers and drill data."
        : "Use a valid ZIP archive.",
    );
  }
  const bom = artifact.kind === "manufacturingBom" ? inspectReleaseBom(bytes) : ok(null);
  if (!bom.ok) return bom;
  if (artifact.contentType === "application/pdf" && bytes.subarray(0, 5).toString() !== "%PDF-")
    return err(uploadInvalid);
  if (
    artifact.contentType === "image/png" &&
    bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
  )
    return err(uploadInvalid);
  return ok({ bytes, sha256: checksum(bytes), bomEntries: bom.value });
}

export async function requestReleaseArtifactUpload(
  db: Db,
  who: NativeSessionRef,
  input: ArtifactUpload,
  signal: AbortSignal,
  storage: StorageClient = makeStorageClient(),
): Promise<ArtifactResult<{ artifactId: string; post: PresignedPost }>> {
  const name = uploadName(input.name);
  if (name === null) return err(uploadNameInvalid);
  const contentType = uploadType(input.kind, name);
  if (contentType === null) return err(uploadInvalid);
  if (!validSize(input.sizeBytes, artifactSizeLimit(input.kind))) return err(uploadSizeInvalid);

  const artifactId = randomUUID();
  const objectKey = uploadKey(input.releaseId, artifactId);
  const reserved = await withReleaseActor(db, who, signal, async (tx, actor) => {
    await lockEditableRelease(tx, actor, input.releaseId, signal);
    await tx.insert(inventoryReleaseArtifacts).values({
      id: artifactId,
      releaseId: input.releaseId,
      kind: input.kind,
      name,
      sizeBytes: input.sizeBytes,
      contentType,
      objectKey,
      createdBy: actor.id,
    });
    return ok(undefined);
  });
  if (!reserved.ok) return reserved;

  const post = await storage.presignPost(objectKey, contentType, signal, input.sizeBytes);
  if (!post.ok) return err("The release file upload could not be started.");
  const current = await readPending(db, who, { releaseId: input.releaseId, artifactId }, signal);
  if (!current.ok) return current;
  return ok({ artifactId, post: post.value });
}

async function readPending(
  db: Db,
  who: NativeSessionRef,
  input: ArtifactTarget,
  signal: AbortSignal,
): Promise<ArtifactResult<Artifact>> {
  return withReleaseActor(db, who, signal, async (tx, actor) => {
    await authorizeArtifactRelease(tx, actor, input.releaseId, "edit", signal);
    const artifact = await findArtifact(tx, input);
    if (artifact === undefined) return err(unavailable);
    if (artifact.createdBy !== actor.id) return err(pendingWrongOwner);
    return ok(artifact);
  });
}

async function readyBomExists(tx: Db, releaseId: string) {
  const [existing] = await tx
    .select({ id: inventoryReleaseArtifacts.id })
    .from(inventoryReleaseArtifacts)
    .where(
      and(
        eq(inventoryReleaseArtifacts.releaseId, releaseId),
        eq(inventoryReleaseArtifacts.kind, "manufacturingBom"),
        eq(inventoryReleaseArtifacts.state, "ready"),
      ),
    )
    .limit(1);
  return existing !== undefined;
}

type Seal = {
  objectKey: string;
  etag: string;
  sha256: string;
  bomEntries: ReleaseBomEntry[] | null;
};

async function commitConfirmation(
  db: Db,
  who: NativeSessionRef,
  input: ArtifactTarget,
  staging: Artifact,
  seal: Seal,
  signal: AbortSignal,
): Promise<ArtifactResult<{ committed: boolean }>> {
  return withReleaseActor<{ committed: boolean }>(db, who, signal, async (tx, actor) => {
    await lockEditableRelease(tx, actor, input.releaseId, signal);
    const artifact = await findArtifact(tx, input);
    if (artifact === undefined) return err(unavailable);
    if (artifact.createdBy !== actor.id) return err(pendingWrongOwner);
    if (artifact.state === "ready") return ok({ committed: false });
    if (artifact.objectKey !== staging.objectKey) return err(verificationFailed);
    if (artifact.kind === "manufacturingBom" && (await readyBomExists(tx, artifact.releaseId)))
      return err("Remove the existing manufacturing BOM before adding another.");
    await tx
      .update(inventoryReleaseArtifacts)
      .set({ ...seal, state: "ready" })
      .where(targetFilter(input));
    return ok({ committed: true });
  });
}

async function tryRemoveObject(storage: StorageClient, key: string) {
  // Storage cleanup is separate from the user operation. Never delete an object
  // whose database commit outcome is unknown.
  try {
    await storage.deleteObject(key, AbortSignal.timeout(4000));
  } catch {
    // Leftover objects stay private. No route can serve an unreferenced key.
  }
}

async function sealStaging(
  storage: StorageClient,
  artifact: Artifact,
  verified: VerifiedArtifact,
  signal: AbortSignal,
): Promise<ArtifactResult<Seal>> {
  const objectKey = sealedKey(artifact.releaseId, artifact.id);
  const written = await storage.putObjectBytes(
    objectKey,
    verified.bytes,
    artifact.contentType,
    signal,
  );
  if (!written.ok) {
    await tryRemoveObject(storage, objectKey);
    return err("The validated release file could not be saved.");
  }
  const head = await storage.headObject(objectKey, signal);
  if (
    !head.ok ||
    head.value.size !== artifact.sizeBytes ||
    head.value.contentType !== artifact.contentType ||
    head.value.etag === ""
  ) {
    await tryRemoveObject(storage, objectKey);
    return err(verificationFailed);
  }
  return ok({
    objectKey,
    etag: head.value.etag,
    sha256: verified.sha256,
    bomEntries: verified.bomEntries,
  });
}

export async function confirmReleaseArtifactUpload(
  db: Db,
  who: NativeSessionRef,
  input: ArtifactTarget,
  signal: AbortSignal,
  storage: StorageClient = makeStorageClient(),
): Promise<ArtifactResult<{ artifactId: string }>> {
  const pending = await readPending(db, who, input, signal);
  if (!pending.ok) return pending;
  if (pending.value.state === "ready") return ok({ artifactId: input.artifactId });
  const verified = await loadStaging(storage, pending.value, signal);
  if (!verified.ok) {
    // Another confirmation can commit and remove staging between our initial
    // lookup and provider read. Treat that ready row as the original receipt.
    const latest = await readPending(db, who, input, signal);
    return latest.ok && latest.value.state === "ready"
      ? ok({ artifactId: input.artifactId })
      : verified;
  }
  const sealed = await sealStaging(storage, pending.value, verified.value, signal);
  if (!sealed.ok) return sealed;

  const committed = await commitConfirmation(db, who, input, pending.value, sealed.value, signal);
  if (!committed.ok || !committed.value.committed) {
    await tryRemoveObject(storage, sealed.value.objectKey);
  } else {
    await tryRemoveObject(storage, pending.value.objectKey);
  }
  return committed.ok ? ok({ artifactId: input.artifactId }) : committed;
}

export async function removeReleaseArtifact(
  db: Db,
  who: NativeSessionRef,
  input: ArtifactTarget,
  signal: AbortSignal,
  storage: StorageClient = makeStorageClient(),
): Promise<ArtifactResult<{ artifactId: string }>> {
  const removed = await withReleaseActor(db, who, signal, async (tx, actor) => {
    await lockEditableRelease(tx, actor, input.releaseId, signal);
    const [artifact] = await tx
      .delete(inventoryReleaseArtifacts)
      .where(targetFilter(input))
      .returning({ objectKey: inventoryReleaseArtifacts.objectKey });
    return ok(artifact);
  });
  if (!removed.ok) return removed;
  if (removed.value !== undefined) await tryRemoveObject(storage, removed.value.objectKey);
  return ok({ artifactId: input.artifactId });
}

type DownloadTarget = ArtifactTarget & { orderId?: string };

async function authorizeDownload(
  db: Db,
  who: NativeSessionRef,
  input: DownloadTarget,
  signal: AbortSignal,
): Promise<ArtifactResult<Artifact>> {
  return withReleaseActor(db, who, signal, async (tx, actor) => {
    await authorizeArtifactRelease(tx, actor, input.releaseId, "view", signal, input.orderId);
    const artifact = await findArtifact(tx, input);
    if (
      artifact?.state !== "ready" ||
      artifact.sha256 === null ||
      !validSize(artifact.sizeBytes, releaseFixtureMaxFileBytes)
    )
      return err(unavailable);
    return ok(artifact);
  });
}

export async function readReleaseArtifactDownload(
  db: Db,
  who: NativeSessionRef,
  input: DownloadTarget,
  signal: AbortSignal,
  storage: StorageClient = makeStorageClient(),
): Promise<ArtifactResult<ArtifactDownload>> {
  const found = await authorizeDownload(db, who, input, signal);
  if (!found.ok) return found;
  const artifact = found.value;
  const head = await storage.headObject(artifact.objectKey, signal);
  if (
    !head.ok ||
    head.value.size !== artifact.sizeBytes ||
    head.value.contentType !== artifact.contentType ||
    head.value.etag !== artifact.etag
  )
    return err(verificationFailed);
  const loaded = await storage.getObjectBytes(artifact.objectKey, signal, artifact.sizeBytes);
  if (
    !loaded.ok ||
    loaded.value.length !== artifact.sizeBytes ||
    checksum(loaded.value) !== artifact.sha256
  )
    return err(verificationFailed);

  // Recheck independently after storage I/O. The response serves the verified
  // buffer, so an object subsequently replaced at that key cannot leak bytes.
  const current = await authorizeDownload(db, who, input, signal);
  if (
    !current.ok ||
    current.value.objectKey !== artifact.objectKey ||
    current.value.sha256 !== artifact.sha256
  )
    return err(unavailable);
  return ok({ name: artifact.name, contentType: artifact.contentType, bytes: loaded.value });
}
