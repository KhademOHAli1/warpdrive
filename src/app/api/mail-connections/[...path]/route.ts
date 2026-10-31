import { db } from "@/db/client";
import { createMailConnectionHttp } from "@/features/email/mailConnectionHttp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handle = createMailConnectionHttp(db);
export const GET = handle;
export const POST = handle;
