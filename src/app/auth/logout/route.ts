import { proxyBackendRequest } from "@/frontend/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = proxyBackendRequest;
export const GET = proxyBackendRequest;
