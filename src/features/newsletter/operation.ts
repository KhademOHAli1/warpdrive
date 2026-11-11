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
  onMutationDispatch?: () => void;
};

type PreparedOperation = {
  input: unknown;
  execute: () => Promise<unknown>;
};

export type NewsletterOperation = {
  prepare(raw: unknown, context: NewsletterExecution): PreparedOperation;
  run(raw: unknown, context: NewsletterExecution): Promise<unknown>;
};

export function defineLocalOperation<S extends z.ZodType>(
  schema: S,
  run: (input: z.output<S>, context: NewsletterExecution) => Promise<unknown>,
): NewsletterOperation {
  function prepare(raw: unknown, context: NewsletterExecution): PreparedOperation {
    const input = schema.safeParse(raw);
    if (!input.success) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Check the campaign form values." });
    }
    return { input: input.data, execute: () => run(input.data, context) };
  }
  return {
    prepare,
    async run(raw, context) {
      return prepare(raw, context).execute();
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
    run(createListmonkClient(context.signal, context.onMutationDispatch), input, context),
  );
}
