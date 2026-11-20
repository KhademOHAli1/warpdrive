import { webReadiness } from "@/frontend/readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const code = await webReadiness();
  const ok = code === "WEB_READY";
  return Response.json(
    { ok, code },
    {
      status: ok ? 200 : 503,
      headers: { "cache-control": "no-store", "x-warpdrive-runtime-code": code },
    },
  );
}
