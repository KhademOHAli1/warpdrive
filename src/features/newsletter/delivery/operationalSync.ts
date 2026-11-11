import { z } from "zod";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { ListmonkClient } from "../listmonkClient";
import { type OperationalEvent, operationalPageSchema } from "./operationalContracts";

const ackSchema = z.strictObject({ acknowledged: z.number().int().min(0).max(100) });
type Client = Pick<ListmonkClient, "json" | "hasOperationalContract">;

/** The consumer resolves only after its transaction commits. ACK loss safely replays native IDs. */
export async function drainOperationalEvents(
  client: Client,
  consume: (events: OperationalEvent[]) => Promise<unknown>,
  signal: AbortSignal,
): Promise<void> {
  if (!(await client.hasOperationalContract()))
    throw new AppError(
      ERROR_IDS.INTEGRATION_STATE_INVALID,
      "Newsletter operational contract unavailable",
    );
  for (let pageIndex = 0; pageIndex < 3; pageIndex += 1) {
    signal.throwIfAborted();
    const page = operationalPageSchema.parse(
      await client.json("GET", "/api/warpdrive/operational-events", {
        query: new URLSearchParams({ limit: "100" }),
      }),
    );
    if (page.events.length === 0) {
      if (page.pending)
        throw new AppError(
          ERROR_IDS.INTEGRATION_STATE_INVALID,
          "Newsletter operational queue made no progress",
        );
      return;
    }
    await consume(page.events);
    signal.throwIfAborted();
    const ack = ackSchema.parse(
      await client.json("POST", "/api/warpdrive/operational-events/ack", {
        body: { event_ids: page.events.map((event) => event.id) },
      }),
    );
    if (ack.acknowledged !== page.events.length)
      throw new AppError(
        ERROR_IDS.INTEGRATION_STATE_INVALID,
        "Invalid newsletter event acknowledgement",
      );
    if (!page.pending) return;
  }
}
