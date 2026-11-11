import { z } from "zod";
import { recordAudit } from "@/features/identity/audit";
import { defineOperation } from "../operation";
import { hasNewsletterPermission } from "../permissions";
import { deliveryStatus, reviewReferencePattern } from "./contracts";
import { readEngineReadiness } from "./readiness";

const campaign = z.strictObject({ id: z.number().int().positive().max(2_147_483_647) });

export const deliveryReads = {
  "admin.readiness": defineOperation(z.strictObject({}), (client) => readEngineReadiness(client)),
  "delivery.status": defineOperation(campaign, async (client, { id }, { actor }) => {
    const status = deliveryStatus.parse(await client.json("GET", `/api/warpdrive-delivery/${id}`));
    return hasNewsletterPermission(actor, "operate") ? status : { ...status, review: [] };
  }),
};

export const deliveryWrites = {
  "delivery.resolve": defineOperation(
    campaign.extend({
      deliveryId: z.uuid(),
      outcome: z.enum(["accepted", "rejected"]),
      evidenceReference: z.string().regex(reviewReferencePattern),
      confirmed: z.literal(true),
    }),
    async (client, { id, deliveryId, outcome, evidenceReference }, context) => {
      const resolved = z.literal(true).parse(
        await client.json("POST", `/api/warpdrive-delivery/${id}/resolve`, {
          body: { delivery_id: deliveryId, outcome },
        }),
      );
      await recordAudit(
        context.db,
        {
          actorId: context.actor.id,
          targetType: "settings",
          targetId: null,
          action: "newsletter.delivery.reviewEvidence",
          correlationId: context.operationId ?? null,
          after: { outcome, deliveryId, evidenceReference },
        },
        AbortSignal.timeout(5_000),
      );
      return resolved;
    },
  ),
};
