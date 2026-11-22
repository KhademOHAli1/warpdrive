import { z } from "zod";
import { env } from "@/config/env";
import {
  type AssetMediaResult,
  assetDocumentMaxBytes,
  assetMediaDocumentType,
  assetMediaFilenameMaxLength,
  assetPhotoMaxBytes,
} from "@/features/assets/media/contracts";
import {
  assetMediaId,
  assetMediaKindInput,
  assetMediaMimeInput,
  assetMediaTargetInput,
  assetMediaVersion,
} from "@/features/assets/media/nativeContracts";
import { readAssetMediaFile, uploadAssetMediaFile } from "@/features/assets/media/service";
import { assetMediaBinaryCsp, assetMediaHeaders } from "@/features/assets/media/transport";
import { guardCsrf } from "@/features/identity/actions/shared";
import { createContext } from "@/server/trpc/context";

type RouteContext = { params: Promise<{ targetType: string; targetId: string }> };

const viewInput = z.enum(["preview", "download"]);
const uploadInput = z.strictObject({
  expectedActorId: assetMediaId,
  requestId: assetMediaId,
  version: z
    .string()
    .regex(/^(?:0|[1-9]\d*)$/u)
    .transform(Number)
    .pipe(assetMediaVersion),
  name: z.string().min(1).max(assetMediaFilenameMaxLength),
  kind: assetMediaKindInput,
});
const privacyHeaders = {
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
  "cross-origin-resource-policy": "same-origin",
  "referrer-policy": "same-origin",
};
const statusFor = { unavailable: 404, invalid: 400, conflict: 409, storage: 503 };
const invalid = { ok: false, error: "invalid" } as const;
const unavailable = { ok: false, error: "unavailable" } as const;

function notFound() {
  return new Response(null, { status: 404, headers: privacyHeaders });
}

function json(result: AssetMediaResult, status = result.ok ? 200 : statusFor[result.error]) {
  return Response.json(result, { status, headers: privacyHeaders });
}

async function readTarget({ params }: RouteContext) {
  const { targetType, targetId } = await params;
  return assetMediaTargetInput.safeParse({ type: targetType, id: targetId });
}

function displayName(encoded: string | null) {
  if (encoded === null) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

function parseUpload(request: Request) {
  const header = (name: keyof typeof assetMediaHeaders) =>
    request.headers.get(assetMediaHeaders[name]);
  return uploadInput.safeParse({
    expectedActorId: header("actor"),
    requestId: header("request"),
    version: header("version"),
    name: displayName(header("name")),
    kind: header("kind"),
  });
}

async function readUpload(request: Request, max: number, signal: AbortSignal) {
  const declared = request.headers.get("content-length");
  if (declared !== null && !/^\d+$/u.test(declared)) return { status: 400 } as const;
  if (declared !== null && Number(declared) > max) return { status: 413 } as const;
  if (request.body === null) return { status: 400 } as const;

  const reader = request.body.getReader();
  const cancel = () => void reader.cancel().catch(() => undefined);
  const chunks: Uint8Array[] = [];
  let size = 0;
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > max) return { status: 413 } as const;
      chunks.push(chunk.value);
    }
    if (size === 0 || (declared !== null && Number(declared) !== size))
      return { status: 400 } as const;
    return { status: 200, bytes: Buffer.concat(chunks, size) } as const;
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
    reader.releaseLock();
  }
}

function attachmentFilename(name: string) {
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename*=UTF-8''${encoded}`;
}

export async function GET(request: Request, route: RouteContext) {
  const url = new URL(request.url);
  const target = await readTarget(route);
  const fileId = assetMediaId.safeParse(url.searchParams.get("fileId"));
  const view = viewInput.safeParse(url.searchParams.get("view"));
  if (!target.success || !fileId.success || !view.success) return notFound();
  if (url.search !== `?fileId=${fileId.data}&view=${view.data}`) return notFound();
  const { db, actor, session, projectGuest } = await createContext();
  if (session === null || actor?.isActive !== true || projectGuest !== undefined) return notFound();
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]);
  const result = await readAssetMediaFile(
    db,
    session,
    { target: target.data, fileId: fileId.data, view: view.data },
    signal,
  );
  if (!result.ok) return notFound();
  const { bytes, mime, name } = result.value;
  return new Response(new Uint8Array(bytes), {
    headers: {
      ...privacyHeaders,
      "content-type": mime,
      "content-length": String(bytes.length),
      "content-disposition": view.data === "preview" ? "inline" : attachmentFilename(name),
      "content-security-policy": assetMediaBinaryCsp,
    },
  });
}

export async function POST(request: Request, route: RouteContext) {
  if (!(await guardCsrf(request.headers.get(assetMediaHeaders.csrf))).ok)
    return json(unavailable, 403);
  const target = await readTarget(route);
  const upload = parseUpload(request);
  if (!target.success || !upload.success || new URL(request.url).search !== "")
    return json(invalid);
  const { db, actor, session, projectGuest } = await createContext();
  if (
    session === null ||
    actor?.isActive !== true ||
    actor.id !== upload.data.expectedActorId ||
    projectGuest !== undefined
  )
    return json(unavailable);
  const mime = assetMediaMimeInput.safeParse(request.headers.get("content-type"));
  if (!mime.success || (upload.data.kind === "document") !== (mime.data === assetMediaDocumentType))
    return json(invalid, 415);
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]);
  const maxKind = upload.data.kind === "photo" ? assetPhotoMaxBytes : assetDocumentMaxBytes;
  const content = await readUpload(request, Math.min(maxKind, env.MAX_FILE_BYTES), signal);
  if (content.status !== 200) return json(invalid, content.status);
  const result = await uploadAssetMediaFile(
    db,
    session,
    { ...upload.data, target: target.data, mime: mime.data, bytes: content.bytes },
    signal,
  );
  return json(result);
}
