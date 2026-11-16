import type { NextRequest } from "next/server";
import { db } from "@/db/client";
import { resolveAttachmentDownload } from "@/features/email/attachmentDownload";
import { attachmentDownloadHeaders } from "@/features/email/attachmentDownloadHeaders";
import { createGmailClient } from "@/features/email/gmailClient";
import { makeRefresh } from "@/features/email/gmailRefresh";
import { ensureAccessToken } from "@/features/email/tokens";
import { makeStorageClient } from "@/features/files/storage";
import { createContext } from "@/server/trpc/context";
import { ok } from "@/types/result";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ attachmentId: string }> },
): Promise<Response> {
  const { attachmentId } = await ctx.params;
  const { actor } = await createContext();
  if (actor === null)
    return new Response("Unauthorized", {
      status: 401,
      headers: { "cache-control": "private, no-store" },
    });

  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(30_000)]);
  const resolveClient = async (accountId: string, s: AbortSignal) => {
    const token = await ensureAccessToken(db, {
      accountId,
      signal: s,
      deps: { refresh: makeRefresh(s) },
    });
    if (!token.ok) return token;
    return ok(createGmailClient(token.value.token));
  };

  const r = await resolveAttachmentDownload(
    db,
    { resolveClient, storage: makeStorageClient() },
    { actor, attachmentId },
    signal,
  );
  if (!r.ok)
    return new Response("Not found", {
      status: 404,
      headers: { "cache-control": "private, no-store" },
    });

  return new Response(new Uint8Array(r.value.bytes), {
    headers: attachmentDownloadHeaders(r.value),
  });
}
