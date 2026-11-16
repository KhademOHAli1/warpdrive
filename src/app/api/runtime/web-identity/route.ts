import { frontendIdentity } from "@/frontend/version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public build metadata, with no actor, credentials, database query or image-inspection claim. */
export function GET(): Response {
  return Response.json(frontendIdentity(), {
    headers: { "cache-control": "no-store" },
  });
}
