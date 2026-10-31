import { db } from "@/db/client";
import { nativeAuthGateway } from "@/features/auth/better/nativeGateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request): Promise<Response> {
  return nativeAuthGateway(db, request);
}
export async function POST(request: Request): Promise<Response> {
  return nativeAuthGateway(db, request);
}
