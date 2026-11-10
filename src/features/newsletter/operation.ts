import { TRPCError } from "@trpc/server";
import type { z } from "zod";
import type { Db } from "@/db/client";
import type { HydratedActor } from "@/server/hydrateActor";
import { createListmonkClient, type ListmonkClient } from "./listmonkClient";

export type NewsletterExecution = {
  db: Db;
  actor: HydratedActor;
  signal: AbortSignal;
  configured: boolean;
  deliveryEnabled: boolean;
  requireDelivery: () => void;
};

export type NewsletterOperation = {
  run(raw: unknown, context: NewsletterExecution): Promise<unknown>;
};

export function defineLocalOperation<S extends z.ZodType>(
  schema: S,
  run: (input: z.output<S>, context: NewsletterExecution) => Promise<unknown>,
): NewsletterOperation {
  return {
    async run(raw, context) {
      const input = schema.safeParse(raw);
      if (!input.success) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Check the campaign form values." });
      }
      return run(input.data, context);
    },
  };
}

export function defineOperation<S extends z.ZodType>(
  schema: S,
  run: (
    client: ListmonkClient,
    input: z.output<S>,
    context: NewsletterExecution,
  ) => Promise<unknown>,
): NewsletterOperation {
  return defineLocalOperation(schema, (input, context) =>
    run(createListmonkClient(context.signal), input, context),
  );
}
