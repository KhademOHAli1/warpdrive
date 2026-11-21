import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { AppContext } from "./context";

const t = initTRPC.context<AppContext>().create({ transformer: superjson });

export const router = t.router;
export const publicProcedure = t.procedure;

// Rejects unauthenticated / dead-session / deactivated callers (rule 0).
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (ctx.actor === null || ctx.session === null) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "E_AUTH_003" });
  }
  return next({ ctx: { ...ctx, actor: ctx.actor, session: ctx.session } });
});

// Projects opts in explicitly. Every other protected procedure still treats the guest as anonymous.
export const protectedProjectProcedure = t.procedure.use(({ ctx, next }) => {
  const actor = ctx.actor ?? ctx.projectGuest?.actor;
  const session = ctx.session ?? ctx.projectGuest?.session;
  if (!actor || !session) throw new TRPCError({ code: "UNAUTHORIZED", message: "E_AUTH_003" });
  return next({ ctx: { ...ctx, actor, session } });
});
