import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { ListmonkClient } from "../listmonkClient";

const checkedAt = z.iso.datetime({ offset: true }).nullable();

export const engineReadiness = z.object({
  ready: z.boolean(),
  database: z.object({ status: z.enum(["ready", "unavailable", "migration_required"]) }),
  scheduler: z.object({
    status: z.enum(["ready", "starting", "stale", "passive"]),
    lastScanAt: checkedAt,
  }),
  relay: z.object({
    status: z.enum(["ready", "unconfigured", "unavailable"]),
    checkedAt,
  }),
  media: z.object({
    status: z.enum(["ready", "unavailable", "unchecked"]),
    checkedAt,
  }),
  limits: z.object({
    workers: z.number().int().nonnegative(),
    perWorkerMessagesPerSecond: z.number().int().nonnegative(),
    messagesPerSecond: z.number().int().nonnegative(),
    batchSize: z.number().int().nonnegative(),
    queueCapacity: z.number().int().nonnegative(),
    clamped: z.boolean(),
  }),
  feedback: z.object({
    status: z.enum(["disabled", "configured", "confirmed"]),
    lastEventAt: checkedAt,
  }),
});

export type EngineReadiness = z.infer<typeof engineReadiness>;

export async function readEngineReadiness(client: ListmonkClient): Promise<EngineReadiness> {
  return engineReadiness.parse(await client.json("GET", "/api/warpdrive/readiness"));
}

export async function requireReadyDelivery(client: ListmonkClient): Promise<void> {
  const state = await readEngineReadiness(client);
  if (!state.ready) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Campaign delivery is unavailable. Review Campaign Maintenance.",
    });
  }
}
