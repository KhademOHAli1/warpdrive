import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createListmonkClient } from "../listmonkClient";

const capabilities = z.object({ crmAttribution: z.literal(1) });
const engineId = z.number().int().positive().max(2_147_483_647);
const exposure = z.strictObject({
  deliveryId: z.uuid(),
  campaignId: engineId,
  campaignName: z.string().max(500),
  bindingId: z.uuid(),
  grantId: z.uuid(),
  purposeListId: engineId,
  acceptedAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
});
export type EngineNewsletterExposure = z.output<typeof exposure>;

export async function connectNewsletterAttribution(signal: AbortSignal) {
  const client = createListmonkClient(signal);
  const contract = await client.json("GET", "/api/warpdrive-capabilities");
  if (!capabilities.safeParse(contract).success)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Campaign exposure evidence is unavailable.",
    });
  return async (bindingId: string, deliveryId?: string) => {
    const query =
      deliveryId === undefined ? undefined : new URLSearchParams({ delivery_id: deliveryId });
    const values = z
      .array(exposure)
      .max(100)
      .parse(await client.json("GET", `/api/warpdrive/attribution/${bindingId}`, { query }));
    if (
      values.some(
        (row) =>
          row.bindingId !== bindingId ||
          (deliveryId !== undefined && row.deliveryId !== deliveryId),
      )
    )
      throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
    return values;
  };
}
