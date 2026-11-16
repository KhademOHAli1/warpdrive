import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { validateRequestOrigin } from "@/features/auth/csrf";
import { actionEffects, backendRequest } from "@/server/request";
import { readRequestCsrf } from "@/server/trpc/request-csrf";
import { publicProcedure, router } from "@/server/trpc/trpc";
import { commandHandlers } from "./registry";

export const commandsRouter = router({
  execute: publicProcedure
    .input(z.object({ name: z.string().max(256), args: z.array(z.unknown()).max(16) }).strict())
    .mutation(async ({ input }) => {
      const state = backendRequest();
      if (!state) throw new TRPCError({ code: "UNAUTHORIZED" });
      if (!validateRequestOrigin(readRequestCsrf(state.request.headers)).ok)
        throw new TRPCError({ code: "FORBIDDEN" });
      if (!Object.hasOwn(commandHandlers, input.name)) throw new TRPCError({ code: "NOT_FOUND" });
      // These are the existing public action handlers, not arbitrary exported domain functions.
      // Each handler keeps its own CSRF, authentication, freshness and transactional authority.
      const command = commandHandlers[input.name as keyof typeof commandHandlers];
      const value: unknown = await (command as (...args: never[]) => unknown)(
        ...(input.args as never[]),
      );
      return { value, effects: actionEffects() };
    }),
});
