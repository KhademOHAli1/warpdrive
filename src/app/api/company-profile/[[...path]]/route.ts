import { companyGet, companyPost } from "@/features/company-profile/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path?: string[] }> };
export async function GET(request: Request, context: Context) {
  return companyGet(request, (await context.params).path ?? []);
}
export async function POST(request: Request, context: Context) {
  return companyPost(request, (await context.params).path ?? []);
}
