import { AsyncLocalStorage } from "node:async_hooks";
import { revalidatePath as nextRevalidatePath } from "next/cache";
import { RequestCookies, ResponseCookies } from "next/dist/compiled/@edge-runtime/cookies";
import type { cookies as NextCookies, headers as NextHeaders } from "next/headers";
import { after as nextAfter } from "next/server";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { ActionEffects } from "@/contracts/actionEffects";
import type { ReadWebIdentity } from "@/features/release/webIdentity";
import type { AppContext } from "./trpc/context-core";

interface BackendRequest {
  request: Request;
  cookies: Awaited<ReturnType<typeof NextCookies>>;
  responseCookies: ResponseCookies;
  revalidatePaths: Set<string>;
  deferred: Array<() => void | Promise<void>>;
  context?: Promise<AppContext>;
  readWebIdentity?: ReadWebIdentity;
}

const requests = new AsyncLocalStorage<BackendRequest>();
const pending = new Set<Promise<void>>();

export function backendRequest(): BackendRequest | undefined {
  return requests.getStore();
}

/** Native Core requests own their cookies/context; no serialized actor is accepted. */
export function withBackendRequest<T>(
  request: Request,
  run: () => Promise<T>,
  readWebIdentity?: ReadWebIdentity,
): Promise<T> {
  const incoming = new RequestCookies(new Headers(request.headers));
  const responseCookies = new ResponseCookies(new Headers());
  const jar = new Proxy(incoming, {
    get(target, key) {
      if (key === "set")
        return (...args: Parameters<ResponseCookies["set"]>) => {
          responseCookies.set(...args);
          const name = typeof args[0] === "string" ? args[0] : args[0].name;
          const cookie = responseCookies.get(name);
          if (cookie) incoming.set(cookie.name, cookie.value);
          return jar;
        };
      if (key === "delete")
        return (name: string) => {
          responseCookies.delete(name);
          incoming.delete(name);
          return jar;
        };
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function"
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  }) as unknown as BackendRequest["cookies"];
  const state: BackendRequest = {
    request,
    cookies: jar,
    responseCookies,
    revalidatePaths: new Set(),
    deferred: [],
    readWebIdentity,
  };
  return requests.run(state, async () => {
    try {
      const result = await run();
      if (result instanceof Response && responseCookies.getAll().length > 0) {
        const headers = new Headers(result.headers);
        const outgoing = new ResponseCookies(headers);
        for (const cookie of responseCookies.getAll()) outgoing.set(cookie);
        return new Response(result.body, {
          status: result.status,
          statusText: result.statusText,
          headers,
        }) as T;
      }
      return result;
    } finally {
      for (const task of state.deferred) {
        const work = Promise.resolve()
          .then(task)
          .catch(() => console.warn("Core post-commit callback failed"))
          .finally(() => pending.delete(work));
        pending.add(work);
      }
    }
  });
}

/** Called by Core's existing drain before closing producer/database dependencies. */
export async function drainRequestTasks(): Promise<void> {
  while (pending.size > 0) await Promise.all([...pending]);
}

export async function headers(): Promise<Awaited<ReturnType<typeof NextHeaders>>> {
  const state = backendRequest();
  if (state) return new Headers(state.request.headers);
  return (await import("next/headers")).headers();
}

export async function cookies(): Promise<BackendRequest["cookies"]> {
  const state = backendRequest();
  if (state) return state.cookies;
  return (await import("next/headers")).cookies();
}

export function after(task: () => void | Promise<void>): void {
  const state = backendRequest();
  if (state) state.deferred.push(task);
  else nextAfter(task);
}

export function revalidatePath(path: string): void {
  const state = backendRequest();
  if (state) state.revalidatePaths.add(path);
  else nextRevalidatePath(path);
}

export function actionEffects(): ActionEffects {
  const state = backendRequest();
  if (!state)
    throw new AppError(ERROR_IDS.AUTH_POLICY_DENIED, "Backend action requires an HTTP request");
  return {
    revalidatePaths: [...state.revalidatePaths],
  };
}
