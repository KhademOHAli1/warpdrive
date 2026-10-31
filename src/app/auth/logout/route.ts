import { db } from "@/db/client";
import { logoutCurrentRequest } from "@/features/auth/better/logoutCurrentRequest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request): Promise<Response> {
  return logoutCurrentRequest(db, request, AbortSignal.timeout(10_000));
}

// A link, prefetch or cross-site navigation must never mutate authentication state.
export function GET(request: Request): Promise<Response> {
  return logoutCurrentRequest(db, request, AbortSignal.timeout(10_000));
}
