import { TRPCError } from "@trpc/server";
import { env } from "@/config/env";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type Options = { body?: unknown; query?: URLSearchParams };

const maxResponseBytes = 8 * 1024 * 1024;

export class NewsletterConnectionError extends Error {
  constructor(readonly uncertain: boolean) {
    super("Campaign service request failed");
  }
}

async function readResponse(response: Response): Promise<string> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let result = "";
  let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) return result + decoder.decode();
      bytes += next.value.byteLength;
      if (bytes > maxResponseBytes) throw new NewsletterConnectionError(false);
      result += decoder.decode(next.value, { stream: true });
    }
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function requestBody(body: unknown, headers: Headers): BodyInit | undefined {
  if (body === undefined) return undefined;
  if (body instanceof FormData || body instanceof URLSearchParams) return body;
  headers.set("content-type", "application/json");
  return JSON.stringify(body);
}

export class ListmonkClient {
  private readonly authorization: string;

  constructor(
    private readonly origin: string,
    username: string,
    token: string,
    private readonly signal: AbortSignal,
  ) {
    this.authorization = `Basic ${Buffer.from(`${username}:${token}`).toString("base64")}`;
  }

  private async request(method: Method, path: string, options: Options): Promise<string> {
    // Callers provide fixed engine paths and validated IDs. Never follow a redirect with a token.
    if (!/^\/api\/[a-zA-Z0-9_./-]+$/.test(path) || path.split("/").includes("..")) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    }
    const url = new URL(path, this.origin);
    if (options.query) url.search = options.query.toString();
    const headers = new Headers({ authorization: this.authorization });
    const body = requestBody(options.body, headers);
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body,
        redirect: "error",
        cache: "no-store",
        signal: this.signal,
      });
    } catch {
      throw new NewsletterConnectionError(method !== "GET");
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      if (response.status === 400 || response.status === 422) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The campaign service rejected these values.",
        });
      }
      if (response.status === 404) throw new TRPCError({ code: "NOT_FOUND" });
      if (response.status === 409) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "The record changed. Refresh and try again.",
        });
      }
      throw new NewsletterConnectionError(method !== "GET" && response.status >= 500);
    }
    try {
      return await readResponse(response);
    } catch {
      throw new NewsletterConnectionError(method !== "GET");
    }
  }

  async json<T = unknown>(method: Method, path: string, options: Options = {}): Promise<T> {
    const text = await this.request(method, path, options);
    try {
      const envelope: unknown = JSON.parse(text);
      if (typeof envelope === "object" && envelope !== null && "data" in envelope) {
        return envelope.data as T;
      }
    } catch {
      // The upstream body can include secrets or personal data. Never surface it in an error.
    }
    throw new NewsletterConnectionError(method !== "GET");
  }

  text(method: Method, path: string, options: Options = {}): Promise<string> {
    return this.request(method, path, options);
  }

  multipart<T = unknown>(path: string, body: FormData): Promise<T> {
    return this.json<T>("POST", path, { body });
  }
}

export function newsletterConfigured(): boolean {
  return env.NEWSLETTER_BASE_URL !== "";
}

export function createListmonkClient(signal: AbortSignal): ListmonkClient {
  if (!newsletterConfigured()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The campaign service is not configured.",
    });
  }
  return new ListmonkClient(
    env.NEWSLETTER_BASE_URL,
    env.NEWSLETTER_API_USER,
    env.NEWSLETTER_API_TOKEN,
    signal,
  );
}
