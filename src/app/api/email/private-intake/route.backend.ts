import { db } from "@/db/client";
import { createPrivateIntakeHttp } from "@/features/email/privateIntakeHttp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handle = createPrivateIntakeHttp(db);
export const GET = handle;
export const POST = handle;
