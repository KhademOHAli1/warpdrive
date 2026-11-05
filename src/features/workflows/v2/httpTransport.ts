import type { IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import type { BlockJson } from "@/features/blocks/contracts";
import type {
  ApprovedEndpoint,
  ConnectionEndpointPolicy,
  EndpointResolver,
} from "@/features/connections/connectionEndpoint";
import { resolveConnectionEndpoint } from "@/features/connections/endpointPolicy";
import { err, ok, type Result } from "@/types/result";
import { isBlockJson, matchesResponseSchema } from "./responseSchema";

const LIMIT = 512 * 1024;
const deniedHeaders = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "upgrade",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
]);
export interface WorkflowHttpInput {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: BlockJson;
  responseSchema?: BlockJson;
}
export interface WorkflowHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: BlockJson;
}
export interface WorkflowTransportError {
  id: string;
  outcome?: "unknown";
}
interface WireRequest {
  endpoint: ApprovedEndpoint;
  path: string;
  host: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal: AbortSignal;
}
type WireResponse = { status: number; headers: IncomingHttpHeaders; text: string };
export interface WorkflowHttpDependencies {
  policy?: ConnectionEndpointPolicy;
  resolver?: EndpointResolver;
  transport?: (input: WireRequest) => Promise<Result<WireResponse, WorkflowTransportError>>;
}

function responseHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).flatMap(([key, value]) =>
      value === undefined || key.toLowerCase() === "set-cookie"
        ? []
        : [[key.toLowerCase(), Array.isArray(value) ? value.join(", ") : value]],
    ),
  );
}
function validHeaders(headers: Record<string, string>): boolean {
  return (
    Object.keys(headers).length <= 50 &&
    Object.entries(headers).every(
      ([key, value]) =>
        /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(key) &&
        !deniedHeaders.has(key.toLowerCase()) &&
        !/[\r\n]/u.test(value) &&
        value.length <= 8192,
    )
  );
}
// The approved numeric address is the actual socket destination. TLS still verifies
// the original hostname; this does not perform a second DNS lookup or follow redirects.
function sendWire(input: WireRequest): Promise<Result<WireResponse, WorkflowTransportError>> {
  return new Promise((resolve) => {
    let completed = false;
    const finish = (result: Result<WireResponse, WorkflowTransportError>) => {
      if (!completed) {
        completed = true;
        resolve(result);
      }
    };
    const request = httpsRequest(
      {
        host: input.endpoint.address,
        family: input.endpoint.family,
        port: input.endpoint.port,
        ...input.endpoint.tls,
        method: input.method,
        path: input.path,
        headers: { ...input.headers, host: input.host },
        signal: input.signal,
        agent: false,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > LIMIT) {
            request.destroy();
            finish(err({ id: "E_WORKFLOW_HTTP_LIMIT", outcome: "unknown" }));
          } else chunks.push(chunk);
        });
        response.on("end", () =>
          finish(
            ok({
              status: response.statusCode ?? 0,
              headers: response.headers,
              text: Buffer.concat(chunks).toString("utf8"),
            }),
          ),
        );
        response.on("error", () =>
          finish(err({ id: "E_WORKFLOW_HTTP_RESPONSE", outcome: "unknown" })),
        );
      },
    );
    // A socket error does not prove that a partially flushed request had no effect.
    request.once("error", () =>
      finish(err({ id: "E_WORKFLOW_HTTP_TRANSPORT", outcome: "unknown" })),
    );
    request.end(input.body);
  });
}
function parseBody(text: string): BlockJson {
  if (text === "") return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return isBlockJson(parsed) ? parsed : text;
  } catch {
    return text;
  }
}
export function workflowHttpsUrl(input: string): URL | null {
  try {
    const url = new URL(input);
    return url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.hash === ""
      ? url
      : null;
  } catch {
    return null;
  }
}
export async function safeWorkflowHttpRequest(
  input: WorkflowHttpInput,
  parentSignal: AbortSignal,
  dependencies: WorkflowHttpDependencies = {},
): Promise<Result<WorkflowHttpResponse, WorkflowTransportError>> {
  const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(15000)]);
  const url = workflowHttpsUrl(input.url);
  if (
    url === null ||
    !["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(input.method)
  )
    return err({ id: "E_WORKFLOW_HTTP_URL" });
  const headers = { ...input.headers };
  if (
    input.body !== undefined &&
    typeof input.body !== "string" &&
    !Object.keys(headers).some((key) => key.toLowerCase() === "content-type")
  )
    headers["content-type"] = "application/json";
  if (!validHeaders(headers)) return err({ id: "E_WORKFLOW_HTTP_HEADERS" });
  const body =
    input.body === undefined
      ? undefined
      : typeof input.body === "string"
        ? input.body
        : JSON.stringify(input.body);
  if (
    body !== undefined &&
    (Buffer.byteLength(body) > LIMIT || ["HEAD", "GET"].includes(input.method))
  )
    return err({ id: "E_WORKFLOW_HTTP_BODY" });
  const approved = await resolveConnectionEndpoint(
    { protocol: "https", host: url.hostname, port: url.port === "" ? 443 : Number(url.port) },
    dependencies.policy ?? { internalEndpoints: [] },
    signal,
    dependencies.resolver,
  );
  if (!approved.ok) return err({ id: "E_WORKFLOW_HTTP_ENDPOINT" });
  try {
    const response = await (dependencies.transport ?? sendWire)({
      endpoint: approved.value,
      path: `${url.pathname}${url.search}`,
      host: url.host,
      method: input.method,
      headers,
      body,
      signal,
    });
    if (!response.ok) return response;
    if (Buffer.byteLength(response.value.text) > LIMIT)
      return err({ id: "E_WORKFLOW_HTTP_LIMIT", outcome: "unknown" });
    const value = parseBody(response.value.text);
    if (input.responseSchema !== undefined && !matchesResponseSchema(input.responseSchema, value))
      return err({ id: "E_WORKFLOW_BLOCK_OUTPUT", outcome: "unknown" });
    return ok({
      status: response.value.status,
      headers: responseHeaders(response.value.headers),
      body: value,
    });
  } catch {
    return err({ id: "E_WORKFLOW_HTTP_TRANSPORT", outcome: "unknown" });
  }
}
