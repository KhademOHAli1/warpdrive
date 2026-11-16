import { billingHttp } from "@/features/billing/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  return billingHttp.GET(request, (await context.params).path ?? []);
}
export async function POST(
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  if (((await context.params).path ?? []).length > 0)
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  return billingHttp.POST(request);
}
