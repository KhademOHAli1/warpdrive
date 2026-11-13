import { env } from "@/config/env";
import { getCurrentVersion } from "@/features/release/currentVersion";
import { declareWebIdentity } from "@/features/release/webIdentity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public build metadata, with no actor, credentials, database query or image-inspection claim. */
export function GET(): Response {
  return Response.json(declareWebIdentity(getCurrentVersion(), env.APP_COMMIT), {
    headers: { "cache-control": "no-store" },
  });
}
