import { proxyBackendRequest } from "@/frontend/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = proxyBackendRequest;
export const HEAD = proxyBackendRequest;
export const POST = proxyBackendRequest;
export const PATCH = proxyBackendRequest;
export const DELETE = proxyBackendRequest;
