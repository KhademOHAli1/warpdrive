import { env } from "@/config/env";
import { db } from "@/db/client";
import { calendarDeploymentConfig } from "@/features/activities/providers/google/authorizationDeployment";
import { handleCalendarAuthorizationStart } from "@/features/activities/providers/google/authorizationStartHttp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: Request): Promise<Response> {
  return handleCalendarAuthorizationStart(
    db,
    request,
    AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]),
    { config: calendarDeploymentConfig(env), baseUrl: env.BASE_URL },
  );
}
export const GET = POST;
