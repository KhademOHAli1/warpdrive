import { z } from "zod";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { readCsrfToken } from "@/utils/csrfCookie";
import {
  type AssetMediaResult,
  type AssetMediaUpload,
  assetMediaDocumentType,
  assetMediaPhotoTypes,
} from "./contracts";
import { assetMediaHeaders, assetMediaPath } from "./transport";

const id = z.uuid();
const mediaFile = z.object({
  id,
  kind: z.enum(["photo", "document"]),
  name: z.string(),
  sizeBytes: z.number().int().positive(),
  mime: z.enum([...assetMediaPhotoTypes, assetMediaDocumentType]),
  uploadedAt: z.iso.datetime(),
  uploadedBy: z.string(),
  previewHref: z.string().nullable(),
  downloadHref: z.string(),
});
const result = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    value: z.object({
      target: z.object({ type: z.enum(["asset", "model"]), id }),
      version: z.number().int().nonnegative(),
      canManage: z.boolean(),
      files: z.array(mediaFile),
      coverId: id.nullable(),
      inheritedCover: mediaFile.nullable(),
      history: z.array(
        z.object({
          id,
          type: z.enum(["uploaded", "cover_changed"]),
          fileId: id.nullable(),
          at: z.iso.datetime(),
          actor: z.string(),
        }),
      ),
    }),
  }),
  z.strictObject({
    ok: z.literal(false),
    error: z.enum(["invalid", "unavailable", "conflict", "storage"]),
  }),
]);

const failures: Partial<Record<number, Extract<AssetMediaResult, { ok: false }>["error"]>> = {
  400: "invalid",
  403: "unavailable",
  404: "unavailable",
  409: "conflict",
  413: "invalid",
  415: "invalid",
  503: "storage",
};

export async function uploadAssetMedia(
  actorId: string,
  input: AssetMediaUpload,
): Promise<AssetMediaResult> {
  const headers = new Headers({
    accept: "application/json",
    "content-type": input.file.type,
    [assetMediaHeaders.actor]: actorId,
    [assetMediaHeaders.version]: String(input.version),
    [assetMediaHeaders.request]: input.requestId,
    [assetMediaHeaders.name]: encodeURIComponent(input.file.name),
    [assetMediaHeaders.kind]: input.kind,
  });
  const csrf = readCsrfToken();
  if (csrf !== null) headers.set(assetMediaHeaders.csrf, csrf);
  const response = await fetch(assetMediaPath(input.target), {
    method: "POST",
    credentials: "same-origin",
    redirect: "error",
    cache: "no-store",
    headers,
    body: input.file,
  });
  const parsed = result.safeParse(await response.json());
  if (parsed.success) {
    const value = parsed.data;
    if (!value.ok && failures[response.status] === value.error) return value;
    if (
      value.ok &&
      (response.status === 200 || response.status === 201) &&
      value.value.target.type === input.target.type &&
      value.value.target.id === input.target.id
    )
      return value;
  }
  // A malformed or interrupted response does not establish whether the upload committed.
  throw new AppError(
    ERROR_IDS.FILE_UPLOAD_RESPONSE_INVALID,
    "Invalid equipment file upload response",
  );
}
