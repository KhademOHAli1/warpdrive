import { env } from "@/config/env";
import { db } from "@/db/client";
import { handleCalendarAuthorizationCallback } from "@/features/activities/providers/google/authorizationCallbackHttp";
import { calendarDeploymentConfig } from "@/features/activities/providers/google/authorizationDeployment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request): Promise<Response> {
  return handleCalendarAuthorizationCallback(
    db,
    request,
    AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]),
    { config: calendarDeploymentConfig(env), baseUrl: env.BASE_URL },
  );
}
export const HEAD = GET;
