export const dynamic = "force-dynamic";

/** Web liveness is independent of Core; backend readiness is checked at Core's /readyz. */
export function GET(): Response {
  return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
