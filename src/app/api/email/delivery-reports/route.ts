import { db } from "@/db/client";
import { createDeliveryObservationHttp } from "@/features/email/deliveryObservationHttp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handle = createDeliveryObservationHttp(db);
export const GET = handle;
export const POST = handle;
