import { z } from "zod";

export const deliveryStates = [
  "pending",
  "leased",
  "submitting",
  "accepted",
  "rejected",
  "unknown",
  "suppressed",
] as const;

export const reviewReferencePattern =
  /^(?:[1-9][0-9]{0,15}|[A-Z]{2,12}-[0-9]{1,16}|[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12})$/;

export const deliveryStatus = z.object({
  hold: z.enum(["", "legacy", "revision_changed"]),
  counts: z.partialRecord(z.enum(deliveryStates), z.number().int().nonnegative()),
  rates: z
    .array(
      z.object({
        minute: z.iso.datetime({ offset: true }),
        accepted: z.number().int().nonnegative(),
      }),
    )
    .max(15)
    .default([]),
  review: z.array(
    z.object({
      id: z.uuid(),
      message_id: z.string().max(240),
      attempts: z.number().int().nonnegative(),
      updated_at: z.iso.datetime({ offset: true }),
    }),
  ),
});

export type DeliveryStatus = z.infer<typeof deliveryStatus>;
