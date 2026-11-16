import { proxyBackendRequest } from "@/frontend/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = proxyBackendRequest;
export const POST = proxyBackendRequest;
export const DELETE = proxyBackendRequest;
export const HEAD = proxyBackendRequest;
export const OPTIONS = proxyBackendRequest;
export const PATCH = proxyBackendRequest;
export const PUT = proxyBackendRequest;
