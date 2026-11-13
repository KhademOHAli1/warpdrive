import type { AnyTRPCRouter } from "@trpc/server";
import { type FetchCreateContextOption, fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { HTTPBaseHandlerOptions } from "@trpc/server/http";
import { withServerTiming } from "@/app/api/trpc/withServerTiming";
import { captureServerError } from "@/features/observability/server";

const EXPECTED = new Set([
  "UNAUTHORIZED",
  "FORBIDDEN",
  "BAD_REQUEST",
  "NOT_FOUND",
  "TIMEOUT",
  "CONFLICT",
  "TOO_MANY_REQUESTS",
  "PARSE_ERROR",
]);

type HttpOptions<TRouter extends AnyTRPCRouter> = Omit<
  HTTPBaseHandlerOptions<TRouter, Request>,
  "onError"
> &
  FetchCreateContextOption<TRouter> & { captureError?: typeof captureServerError };

function errorActorId(context: unknown): string | null {
  if (context === null || typeof context !== "object" || !("actor" in context)) return null;
  const actor = context.actor;
  if (actor === null || typeof actor !== "object" || !("id" in actor)) return null;
  return typeof actor.id === "string" ? actor.id : null;
}

/** Shared Fetch transport; request/context ownership stays with its Next or native adapter. */
export function createTrpcHttpHandler<TRouter extends AnyTRPCRouter>(
  options: HttpOptions<TRouter>,
): (request: Request) => Promise<Response> {
  const captureError = options.captureError ?? captureServerError;
  const onError: NonNullable<HTTPBaseHandlerOptions<TRouter, Request>["onError"]> = ({
    error,
    ctx,
    path,
  }) => {
    if (!EXPECTED.has(error.code))
      captureError(errorActorId(ctx), error, { path: path ?? "", route: "trpc" });
  };
  return withServerTiming((request) =>
    fetchRequestHandler<TRouter>(
      Object.assign({}, options, { endpoint: "/api/trpc", req: request, onError }),
    ),
  );
}
