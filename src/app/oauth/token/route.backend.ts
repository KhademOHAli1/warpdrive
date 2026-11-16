import { db } from "@/db/client";
import { createTokenHandler } from "@/features/oauth/tokenHttp";

export const POST = createTokenHandler(db);
