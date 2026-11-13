import { z } from "zod";
import { db } from "@/db/client";
import { blockOutputSchema } from "@/features/blocks/schemas";
import { createWorkflowV2Adapters } from "@/features/workflows/v2/adapters";
import { nudgeWorkflowV2Run } from "@/features/workflows/v2/queue";
import { isBlockJson } from "@/features/workflows/v2/responseSchema";
import { admitWorkflowV2Webhook } from "@/features/workflows/v2/webhook";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workflowId: string }> },
) {
  const { workflowId } = await params;
  const requestKey = request.headers.get("idempotency-key");
  if (!z.uuid().safeParse(workflowId).success || !z.uuid().safeParse(requestKey).success)
    return Response.json({ error: "invalid_request" }, { status: 400 });
  const reader = request.body?.getReader();
  if (reader === undefined) return Response.json({ error: "invalid_body" }, { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 128_000) {
        await reader.cancel();
        return Response.json({ error: "body_too_large" }, { status: 413 });
      }
      chunks.push(part.value);
    }
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  if (!isBlockJson(payload)) return Response.json({ error: "invalid_body" }, { status: 400 });
  const parsed = blockOutputSchema.safeParse(payload);
  if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 400 });
  const authorization = request.headers.get("authorization");
  const apiKey = authorization?.startsWith("Bearer ") === true ? authorization.slice(7) : null;
  const result = await admitWorkflowV2Webhook(
    db,
    workflowId,
    { apiKey, requestKey: requestKey as string, payload: parsed.data },
    createWorkflowV2Adapters(),
    AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]),
  );
  if (!result.ok)
    return Response.json(
      { error: result.error },
      { status: result.error.includes("CONFLICT") ? 409 : 403 },
    );
  await nudgeWorkflowV2Run(result.value.id);
  return Response.json({ runId: result.value.id }, { status: 202 });
}
