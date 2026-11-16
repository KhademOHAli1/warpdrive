import { createTRPCProxyClient, getUntypedClient, httpBatchLink, httpLink } from "@trpc/client";
import { ResponseCookies } from "next/dist/compiled/@edge-runtime/cookies";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import superjson from "superjson";
import type { AppRouter } from "@/server/trpc/root";
import { coreOrigin } from "./config";
import { backendHeaders } from "./headers";

function makeClient(writableCookies: boolean) {
  return createTRPCProxyClient<AppRouter>({
    links: [
      (writableCookies ? httpLink : httpBatchLink)({
        url: `${coreOrigin()}/api/trpc`,
        transformer: superjson,
        headers: async () => Object.fromEntries(backendHeaders(await headers())),
        fetch: async (url, requestOptions) => {
          const response = await fetch(url, {
            ...requestOptions,
            cache: "no-store",
            redirect: "error",
            signal: requestOptions?.signal
              ? AbortSignal.any([requestOptions.signal, AbortSignal.timeout(60_000)])
              : AbortSignal.timeout(60_000),
          });
          if (writableCookies && response.headers.has("set-cookie")) {
            const jar = await cookies();
            for (const cookie of new ResponseCookies(new Headers(response.headers)).getAll())
              jar.set(cookie);
          }
          return response;
        },
      }),
    ],
  });
}

// React owns this cache per render request. Parallel SSR reads share a batch, never an actor
// across requests; action writes use an individual HTTP request and writable response cookies.
const readClient = cache(() => makeClient(false));
export function coreClient(options: { writableCookies?: boolean } = {}) {
  return options.writableCookies === true ? makeClient(true) : readClient();
}

/** The existing SSR read-call shape, transported over HTTP instead of an in-process router. */
export function createCaller(_context?: unknown): ReturnType<AppRouter["createCaller"]> {
  void _context;
  const client = getUntypedClient(coreClient());
  const read = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      get: (_target, key) =>
        key === "then" || typeof key !== "string" ? undefined : read([...path, key]),
      apply: (_target, _receiver, args) => client.query(path.join("."), args[0]),
    });
  return read([]) as ReturnType<AppRouter["createCaller"]>;
}
