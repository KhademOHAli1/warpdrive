import { db } from "@/db/client";
import { createAuthorizationHandlers } from "@/features/oauth/authorizationHttp";

const handlers = createAuthorizationHandlers(db);

export const GET = handlers.GET;
export const POST = handlers.POST;
