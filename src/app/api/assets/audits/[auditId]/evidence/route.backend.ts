import sharp from "sharp";
import { z } from "zod";
import { env } from "@/config/env";
import type { EquipmentAuditError, EquipmentAuditWrite } from "@/features/assets/audits/contracts";
import {
  attachEquipmentAuditEvidence,
  readEquipmentAuditEvidence,
} from "@/features/assets/audits/evidence";
import {
  auditPhotoHeaders,
  auditPhotoMaxBytes,
  auditPhotoTypes,
  type EquipmentAuditPhotoMime,
} from "@/features/assets/audits/evidenceTransport";
import { guardCsrf } from "@/features/identity/actions/shared";
import { createContext } from "@/server/trpc/context";

type RouteContext = { params: Promise<{ auditId: string }> };
const id = z.uuid().toLowerCase();
const mimeType = z.enum(auditPhotoTypes);
const attachment = z.strictObject({
  auditId: id,
  expectedActorId: id,
  requestId: id,
  rowId: id.nullable(),
  version: z
    .string()
    .regex(/^[1-9]\d*$/u)
    .transform(Number)
    .pipe(z.number().int().positive()),
  source: z.enum(["camera", "file"]),
  name: z
    .string()
    .trim()
    .min(1)
    .max(180)
    .refine((value) => !/[\\/\p{Cc}\p{Bidi_Control}]/u.test(value)),
});
const privacyHeaders = {
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
};
const failureStatus: Record<EquipmentAuditError, number> = {
  invalid: 400,
  unavailable: 404,
  stale: 409,
  conflict: 409,
  state: 409,
  quantity: 409,
  storage: 503,
};

function emptyNotFound() {
  return new Response(null, { status: 404, headers: privacyHeaders });
}

function resultResponse(
  result: EquipmentAuditWrite,
  status = result.ok ? 200 : failureStatus[result.error],
) {
  return Response.json(result, { status, headers: privacyHeaders });
}

function parseName(value: string | null) {
  if (value === null) return null;
  try {
    return decodeURIComponent(value).normalize("NFC");
  } catch {
    return null;
  }
}

function parseAttachment(request: Request, auditId: string) {
  const from = (key: keyof typeof auditPhotoHeaders) => request.headers.get(auditPhotoHeaders[key]);
  return attachment.safeParse({
    auditId,
    expectedActorId: from("actor"),
    requestId: from("request"),
    rowId: from("row"),
    version: from("version"),
    source: from("source"),
    name: parseName(from("name")),
  });
}

async function readPhoto(request: Request, signal: AbortSignal) {
  const max = Math.min(auditPhotoMaxBytes, env.MAX_FILE_BYTES);
  const length = request.headers.get("content-length");
  if (length !== null && !/^\d+$/u.test(length)) return { status: 400 } as const;
  if (length !== null && Number(length) > max) return { status: 413 } as const;
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
    if (size === 0 || (length !== null && Number(length) !== size)) return { status: 400 } as const;
    return { status: 200, bytes: Buffer.concat(chunks, size) } as const;
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
    reader.releaseLock();
  }
}

async function validPhoto(bytes: Buffer, mime: EquipmentAuditPhotoMime) {
  try {
    const image = sharp(bytes, { limitInputPixels: 20_000_000, failOn: "warning" }).timeout({
      seconds: 8,
    });
    const { format, pages } = await image.metadata();
    if (`image/${format}` !== mime || (pages ?? 1) !== 1) return false;
    // Metadata identifies the format. Decoding rejects truncated or malformed image data.
    await image.stats();
    return true;
  } catch {
    return false;
  }
}

export async function GET(request: Request, { params }: RouteContext) {
  const url = new URL(request.url);
  const auditId = id.safeParse((await params).auditId);
  const evidenceId = id.safeParse(url.searchParams.get("evidenceId"));
  if (!auditId.success || !evidenceId.success || url.search !== `?evidenceId=${evidenceId.data}`)
    return emptyNotFound();
  const { db, actor, session, projectGuest } = await createContext();
  if (session === null || actor?.isActive !== true || projectGuest !== undefined)
    return emptyNotFound();
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]);
  const result = await readEquipmentAuditEvidence(
    db,
    session,
    { auditId: auditId.data, evidenceId: evidenceId.data },
    signal,
  );
  if (!result.ok) return emptyNotFound();
  const { mime, bytes } = result.value;
  const extension = mime === "image/jpeg" ? "jpg" : "png";
  return new Response(new Uint8Array(bytes), {
    headers: {
      ...privacyHeaders,
      "content-type": mime,
      "content-disposition": `inline; filename="equipment-audit-photo.${extension}"`,
    },
  });
}

export async function POST(request: Request, { params }: RouteContext) {
  if (!(await guardCsrf(request.headers.get(auditPhotoHeaders.csrf))).ok)
    return resultResponse({ ok: false, error: "unavailable" }, 403);
  const input = parseAttachment(request, (await params).auditId);
  if (!input.success || new URL(request.url).search !== "")
    return resultResponse({ ok: false, error: "invalid" });
  const { db, actor, session, projectGuest } = await createContext();
  if (
    session === null ||
    actor?.isActive !== true ||
    actor.id !== input.data.expectedActorId ||
    projectGuest !== undefined
  )
    return resultResponse({ ok: false, error: "unavailable" });
  const mime = mimeType.safeParse(request.headers.get("content-type"));
  if (!mime.success) return resultResponse({ ok: false, error: "invalid" }, 415);
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]);
  const photo = await readPhoto(request, signal);
  if (photo.status !== 200) return resultResponse({ ok: false, error: "invalid" }, photo.status);
  if (!(await validPhoto(photo.bytes, mime.data)))
    return resultResponse({ ok: false, error: "invalid" }, 415);
  signal.throwIfAborted();
  const result = await attachEquipmentAuditEvidence(
    db,
    session,
    { ...input.data, mime: mime.data, bytes: photo.bytes },
    signal,
  );
  return resultResponse(result);
}
