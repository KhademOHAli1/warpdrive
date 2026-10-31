import { z } from "zod";
import { db } from "@/db/client";
import { enforceAuthRateLimit } from "@/features/auth/better/rateLimit";
import { resolveWorkflowSession } from "@/features/auth/better/sessionPolicy";
import { readManagedUserDetails } from "@/features/auth/management/userDetails";
import { hydrateActor } from "@/server/hydrateActor";

const queryInput = z.object({ id: z.string().uuid() });
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request): Promise<Response> {
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10000)]);
  if (!(await enforceAuthRateLimit(db, request.headers, "/security/snapshot", undefined, signal)))
    return Response.json(
      { ok: false, error: "rate_limited" },
      { status: 429, headers: { "Cache-Control": "no-store" } },
    );
  const session = await resolveWorkflowSession(db, request.headers, signal);
  if (session === null)
    return Response.json(
      { ok: false, error: "unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  const actor = await hydrateActor(db, session.user.id, signal);
  if (actor === null)
    return Response.json(
      { ok: false, error: "forbidden" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  const query = queryInput.safeParse({ id: new URL(request.url).searchParams.get("id") });
  if (!query.success)
    return Response.json(
      { ok: false, error: "invalid_input" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  const result = await readManagedUserDetails(db, actor, query.data.id, signal);
  return Response.json(
    result.ok ? { ok: true, data: result.value } : { ok: false, error: result.error },
    { status: result.ok ? 200 : 403, headers: { "Cache-Control": "no-store" } },
  );
}
