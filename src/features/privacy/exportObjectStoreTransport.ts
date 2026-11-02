import * as http from "node:http";
import * as https from "node:https";
import { urlToHttpOptions } from "node:url";
import { Client } from "minio";
import type { ExportStoreConfig } from "./exportObjectStoreTypes";

// Each SDK request gets real socket/body cancellation and a finite deadline.
// A client belongs to one operation, so concurrent callers never replace its signal.
export function exportStoreClient(config: ExportStoreConfig, signal: AbortSignal): Client {
  const endpoint = new URL(config.endpoint);
  function request(
    input: string | URL | http.RequestOptions,
    optionsOrCallback?: http.RequestOptions | ((response: http.IncomingMessage) => void),
    callback?: (response: http.IncomingMessage) => void,
  ): http.ClientRequest {
    signal.throwIfAborted();
    const options =
      typeof input === "string" || input instanceof URL
        ? {
            ...urlToHttpOptions(new URL(input)),
            ...(typeof optionsOrCallback === "object" ? optionsOrCallback : {}),
          }
        : input;
    const handler = typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(config.requestTimeoutMs)]);
    return endpoint.protocol === "https:"
      ? https.request({ ...options, signal: bounded }, handler)
      : http.request({ ...options, signal: bounded }, handler);
  }
  return new Client({
    endPoint: endpoint.hostname,
    port:
      endpoint.port.length > 0 ? Number(endpoint.port) : endpoint.protocol === "https:" ? 443 : 80,
    useSSL: endpoint.protocol === "https:",
    accessKey: config.accessKey,
    secretKey: config.secretKey,
    region: "us-east-1",
    pathStyle: true,
    transport: { request },
    retryOptions: { disableRetry: true },
  });
}

export function storeErrorCode(cause: unknown): string | undefined {
  return typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    typeof cause.code === "string"
    ? cause.code
    : undefined;
}
export function missingStoreObject(cause: unknown): boolean {
  const code = storeErrorCode(cause);
  return (
    code !== undefined && ["NoSuchKey", "NoSuchObject", "NoSuchVersion", "NotFound"].includes(code)
  );
}
