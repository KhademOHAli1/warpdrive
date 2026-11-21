import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import type { Db } from "@/db/client";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { err, ok } from "@/types/result";
import { lockInternalProject, withInternalProjects } from "../access";
import { maxProjectCoverUpload, maxStoredProjectCover, type ProjectCover } from "./contracts";
import { internalProjectCoverAssets as assets } from "./schema";

export async function normalizeProjectCover(base64: string) {
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length > maxProjectCoverUpload || bytes.toString("base64") !== base64) return null;
  try {
    const image = sharp(bytes, { limitInputPixels: 24_000_000, failOn: "error" });
    const { format } = await image.metadata();
    if (format !== "jpeg" && format !== "png" && format !== "webp") return null;
    const normalized = await image
      .rotate()
      .resize({ width: 1_600, height: 600, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    return normalized.length <= maxStoredProjectCover ? normalized : null;
  } catch {
    return null;
  }
}

export async function storeProjectCover(
  db: Db,
  projectId: string,
  image: Buffer,
): Promise<ProjectCover> {
  const version = randomUUID();
  await db
    .insert(assets)
    .values({ projectId, version, image })
    .onConflictDoUpdate({ target: assets.projectId, set: { version, image } });
  return { kind: "image", value: version };
}

export async function clearProjectCover(db: Db, projectId: string) {
  await db.delete(assets).where(eq(assets.projectId, projectId));
}

export async function readProjectCoverAsset(db: Db, projectId: string, version: string) {
  const [asset] = await db
    .select({ image: assets.image })
    .from(assets)
    .where(and(eq(assets.projectId, projectId), eq(assets.version, version)));
  return asset?.image ?? null;
}

export function readPrivateProjectCover(
  db: Db,
  session: NativeSessionRef,
  projectId: string,
  version: string,
  signal: AbortSignal,
) {
  return withInternalProjects<Buffer>(db, session, signal, async (tx, actor) => {
    const project = await lockInternalProject(tx, actor, projectId, "read", "work-items");
    if (!project.ok) return project;
    const image = await readProjectCoverAsset(tx, projectId, version);
    return image === null ? err("project_unavailable") : ok(image);
  });
}
